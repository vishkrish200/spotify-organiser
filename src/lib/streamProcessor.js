/**
 * Stream Processor Module
 *
 * Implements streaming data ingestion and processing for real-time or large-scale data
 * with backpressure management and integration with existing optimization modules
 */

const { Readable, Transform, Writable, pipeline } = require("stream");
const { promisify } = require("util");
const chalk = require("chalk");
const EventEmitter = require("events");
const CacheManager = require("./cache");
const BatchManager = require("./batchManager");
const ParallelProcessor = require("./parallelProcessor");
const MemoryOptimizer = require("./memoryOptimizer");
const SkipLogicManager = require("./skipLogicManager");
const ErrorHandler = require("../utils/errorHandler");

const pipelineAsync = promisify(pipeline);

class StreamProcessor extends EventEmitter {
  constructor(options = {}) {
    super();

    // Configuration
    this.config = {
      // Stream configuration
      highWaterMark: options.highWaterMark || 64 * 1024, // 64KB buffer
      objectMode: options.objectMode !== false, // Default to object mode for data processing
      maxConcurrentStreams: options.maxConcurrentStreams || 5,

      // Backpressure management
      backpressureThreshold: options.backpressureThreshold || 1000, // Items in buffer
      backpressureStrategy: options.backpressureStrategy || "drop", // "drop", "buffer", "pause"
      maxBufferSize: options.maxBufferSize || 5000, // Maximum items to buffer

      // Processing configuration
      batchSize: options.batchSize || 100, // Items per batch
      processingDelay: options.processingDelay || 10, // ms delay between batches
      enableSkipLogic: options.enableSkipLogic !== false,
      enableCaching: options.enableCaching !== false,
      enableParallel: options.enableParallel !== false,

      // Performance monitoring
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 5000, // 5 seconds

      // Error handling
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      continueOnError: options.continueOnError !== false,
    };

    // Integration modules (optional - can be injected)
    this.cache = options.cache || null;
    this.batchManager = options.batchManager || null;
    this.parallelProcessor = options.parallelProcessor || null;
    this.memoryOptimizer = options.memoryOptimizer || null;
    this.skipLogicManager = options.skipLogicManager || null;

    // Stream state
    this.activeStreams = new Map();
    this.streamMetrics = {
      totalStreams: 0,
      activeStreams: 0,
      itemsProcessed: 0,
      itemsDropped: 0,
      bytesProcessed: 0,
      errorsCount: 0,
      averageLatency: 0,
      throughput: 0,
      backpressureEvents: 0,
      startTime: Date.now(),
    };

    // Processing buffers
    this.processingBuffer = [];
    this.isProcessing = false;
    this.processingTimer = null;
    this.metricsTimer = null;

    console.log(chalk.green("✅ StreamProcessor initialized"));
  }

  /**
   * Create a data source stream from various input types
   */
  createSourceStream(source, options = {}) {
    const streamId = `stream_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    let sourceStream;

    if (typeof source === "function") {
      // Generator function source
      sourceStream = this.createGeneratorStream(source, options);
    } else if (Array.isArray(source)) {
      // Array source
      sourceStream = this.createArrayStream(source, options);
    } else if (source && typeof source.pipe === "function") {
      // Already a stream
      sourceStream = source;
    } else if (typeof source === "string") {
      // URL or file path source
      sourceStream = this.createURLStream(source, options);
    } else {
      throw new Error("Unsupported source type for streaming");
    }

    // Add stream tracking
    this.activeStreams.set(streamId, {
      stream: sourceStream,
      startTime: Date.now(),
      itemsProcessed: 0,
      options,
    });

    this.streamMetrics.totalStreams++;
    this.streamMetrics.activeStreams++;

    return { streamId, stream: sourceStream };
  }

  /**
   * Create stream from generator function
   */
  createGeneratorStream(generator, options = {}) {
    const stream = new Readable({
      objectMode: this.config.objectMode,
      highWaterMark: this.config.highWaterMark,
      ...options,
    });

    const iterator = generator();

    stream._read = async () => {
      try {
        const { value, done } = await iterator.next();

        if (done) {
          stream.push(null); // End stream
        } else {
          // Skip logic integration (if available)
          if (this.config.enableSkipLogic && this.skipLogicManager) {
            const skipCheck = this.skipLogicManager.shouldSkipOperation(
              "stream_item",
              {
                batch: { data: [value], options: {} },
              }
            );

            if (skipCheck.skip) {
              this.streamMetrics.itemsDropped++;
              return stream._read(); // Skip this item
            }
          }

          stream.push(value);
        }
      } catch (error) {
        stream.emit("error", error);
      }
    };

    return stream;
  }

  /**
   * Create stream from array
   */
  createArrayStream(array, options = {}) {
    let index = 0;

    const stream = new Readable({
      objectMode: this.config.objectMode,
      highWaterMark: this.config.highWaterMark,
      ...options,
    });

    stream._read = () => {
      if (index >= array.length) {
        stream.push(null); // End stream
        return;
      }

      const value = array[index++];

      // Skip logic integration (if available)
      if (this.config.enableSkipLogic && this.skipLogicManager) {
        const skipCheck = this.skipLogicManager.shouldSkipOperation(
          "stream_array_item",
          {
            batch: { data: [value], options: {} },
          }
        );

        if (skipCheck.skip) {
          this.streamMetrics.itemsDropped++;
          return stream._read(); // Skip this item
        }
      }

      stream.push(value);
    };

    return stream;
  }

  /**
   * Create stream from URL (placeholder for future API streaming)
   */
  createURLStream(url, options = {}) {
    // This would implement actual HTTP streaming in a real scenario
    // For now, create a mock stream that could represent API pagination
    const stream = new Readable({
      objectMode: this.config.objectMode,
      highWaterMark: this.config.highWaterMark,
      ...options,
    });

    let page = 0;
    const maxPages = options.maxPages || 10;

    stream._read = async () => {
      if (page >= maxPages) {
        stream.push(null);
        return;
      }

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockData = {
        page: page++,
        url,
        timestamp: Date.now(),
        data: `Mock data for page ${page}`,
      };

      stream.push(mockData);
    };

    return stream;
  }

  /**
   * Create transform stream for data processing
   */
  createProcessingStream(processor, options = {}) {
    const transform = new Transform({
      objectMode: this.config.objectMode,
      highWaterMark: this.config.highWaterMark,
      ...options,
    });

    transform._transform = async (chunk, encoding, callback) => {
      try {
        const startTime = Date.now();

        // Cache integration (if available)
        let result;
        if (this.config.enableCaching && this.cache) {
          const cacheKey = this.generateCacheKey(chunk);
          result = await this.cache.get(cacheKey, async () => {
            return await processor(chunk);
          });
        } else {
          result = await processor(chunk);
        }

        // Update metrics
        const latency = Date.now() - startTime;
        this.updateLatencyMetrics(latency);
        this.streamMetrics.itemsProcessed++;

        callback(null, result);
      } catch (error) {
        this.streamMetrics.errorsCount++;

        if (this.config.continueOnError) {
          console.log(
            chalk.yellow(`⚠️  Stream processing error: ${error.message}`)
          );
          callback(); // Continue without emitting this chunk
        } else {
          callback(error);
        }
      }
    };

    return transform;
  }

  /**
   * Create batch processing stream
   */
  createBatchStream(batchProcessor, options = {}) {
    const batchSize = options.batchSize || this.config.batchSize;
    let batch = [];

    const transform = new Transform({
      objectMode: this.config.objectMode,
      highWaterMark: this.config.highWaterMark,
      ...options,
    });

    transform._transform = async (chunk, encoding, callback) => {
      batch.push(chunk);

      if (batch.length >= batchSize) {
        await this.processBatch(batch, batchProcessor, transform);
        batch = [];
      }

      callback();
    };

    transform._flush = async (callback) => {
      if (batch.length > 0) {
        await this.processBatch(batch, batchProcessor, transform);
      }
      callback();
    };

    return transform;
  }

  /**
   * Process a batch of items
   */
  async processBatch(batch, processor, transform) {
    try {
      // Skip logic for batch (if available)
      if (this.config.enableSkipLogic && this.skipLogicManager) {
        const skipCheck = this.skipLogicManager.shouldSkipBatchOperation(
          "stream_batch",
          batch
        );
        if (skipCheck.skip) {
          this.streamMetrics.itemsDropped += batch.length;
          return;
        }
      }

      // Parallel processing integration (if available)
      let results;
      if (
        this.config.enableParallel &&
        this.parallelProcessor &&
        batch.length > 50
      ) {
        results = await this.parallelProcessor.processAsync(batch, processor);
      } else {
        results = await processor(batch);
      }

      // Emit results
      if (Array.isArray(results)) {
        results.forEach((result) => transform.push(result));
      } else {
        transform.push(results);
      }
    } catch (error) {
      this.streamMetrics.errorsCount++;
      if (!this.config.continueOnError) {
        throw error;
      }
    }
  }

  /**
   * Create destination stream for output
   */
  createDestinationStream(handler, options = {}) {
    const writable = new Writable({
      objectMode: this.config.objectMode,
      highWaterMark: this.config.highWaterMark,
      ...options,
    });

    writable._write = async (chunk, encoding, callback) => {
      try {
        await handler(chunk);
        callback();
      } catch (error) {
        this.streamMetrics.errorsCount++;

        if (this.config.continueOnError) {
          console.log(
            chalk.yellow(`⚠️  Stream output error: ${error.message}`)
          );
          callback();
        } else {
          callback(error);
        }
      }
    };

    return writable;
  }

  /**
   * Create complete streaming pipeline
   */
  async createPipeline(source, processors, destination, options = {}) {
    const { streamId, stream: sourceStream } = this.createSourceStream(
      source,
      options.source
    );

    try {
      // Build pipeline stages
      const stages = [sourceStream];

      // Add processing stages
      if (processors && processors.length > 0) {
        for (const processor of processors) {
          if (typeof processor === "function") {
            stages.push(
              this.createProcessingStream(processor, options.processing)
            );
          } else if (processor.type === "batch") {
            stages.push(
              this.createBatchStream(processor.handler, {
                ...options.batch,
                batchSize: processor.batchSize,
              })
            );
          } else if (processor.stream) {
            stages.push(processor.stream);
          }
        }
      }

      // Add destination
      if (destination) {
        if (typeof destination === "function") {
          stages.push(
            this.createDestinationStream(destination, options.destination)
          );
        } else {
          stages.push(destination);
        }
      }

      // Monitor backpressure
      this.monitorBackpressure(stages);

      // Execute pipeline
      await pipelineAsync(...stages);

      console.log(
        chalk.green(`✅ Stream pipeline ${streamId} completed successfully`)
      );

      return {
        streamId,
        success: true,
        metrics: this.getStreamMetrics(streamId),
      };
    } catch (error) {
      console.log(
        chalk.red(`❌ Stream pipeline ${streamId} failed: ${error.message}`)
      );

      return {
        streamId,
        success: false,
        error: error.message,
        metrics: this.getStreamMetrics(streamId),
      };
    } finally {
      this.cleanupStream(streamId);
    }
  }

  /**
   * Monitor backpressure across pipeline stages
   */
  monitorBackpressure(stages) {
    stages.forEach((stage, index) => {
      if (stage.readable || stage.writable) {
        stage.on("drain", () => {
          this.streamMetrics.backpressureEvents++;
          console.log(
            chalk.yellow(`⚠️  Backpressure resolved at stage ${index}`)
          );
        });
      }
    });
  }

  /**
   * Generate cache key for streaming data
   */
  generateCacheKey(data) {
    if (typeof data === "object" && data !== null) {
      const key = data.id || data.key || JSON.stringify(data).substring(0, 50);
      return `stream_${key}`;
    }
    return `stream_${String(data).substring(0, 50)}`;
  }

  /**
   * Update latency metrics
   */
  updateLatencyMetrics(latency) {
    const count = this.streamMetrics.itemsProcessed;
    const current = this.streamMetrics.averageLatency;
    this.streamMetrics.averageLatency =
      (current * count + latency) / (count + 1);
  }

  /**
   * Get metrics for a specific stream
   */
  getStreamMetrics(streamId) {
    const streamData = this.activeStreams.get(streamId);
    if (!streamData) return null;

    return {
      streamId,
      duration: Date.now() - streamData.startTime,
      itemsProcessed: streamData.itemsProcessed,
      options: streamData.options,
    };
  }

  /**
   * Get overall streaming metrics
   */
  getOverallMetrics() {
    const duration = Date.now() - this.streamMetrics.startTime;
    const throughput =
      duration > 0 ? (this.streamMetrics.itemsProcessed / duration) * 1000 : 0;

    return {
      ...this.streamMetrics,
      throughput: Math.round(throughput * 100) / 100, // items/second
      duration,
      efficiency:
        this.streamMetrics.itemsDropped > 0
          ? (
              (this.streamMetrics.itemsProcessed /
                (this.streamMetrics.itemsProcessed +
                  this.streamMetrics.itemsDropped)) *
              100
            ).toFixed(1)
          : 100,
    };
  }

  /**
   * Start metrics monitoring
   */
  startMetricsMonitoring() {
    if (this.metricsTimer) return;

    this.metricsTimer = setInterval(() => {
      if (this.config.enableMetrics) {
        const metrics = this.getOverallMetrics();
        console.log(
          chalk.blue(
            `📊 Stream Metrics: ${metrics.itemsProcessed} items, ${metrics.throughput} items/sec, ${metrics.activeStreams} active streams`
          )
        );
      }
    }, this.config.metricsInterval);
  }

  /**
   * Stop metrics monitoring
   */
  stopMetricsMonitoring() {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  /**
   * Cleanup stream resources
   */
  cleanupStream(streamId) {
    const streamData = this.activeStreams.get(streamId);
    if (streamData) {
      this.activeStreams.delete(streamId);
      this.streamMetrics.activeStreams--;
    }
  }

  /**
   * Shutdown stream processor
   */
  async shutdown() {
    console.log(chalk.gray("📤 StreamProcessor shutdown"));

    // Stop metrics monitoring
    this.stopMetricsMonitoring();

    // Close all active streams
    for (const [streamId, streamData] of this.activeStreams) {
      try {
        if (
          streamData.stream &&
          typeof streamData.stream.destroy === "function"
        ) {
          streamData.stream.destroy();
        }
      } catch (error) {
        console.log(
          chalk.yellow(`⚠️  Error closing stream ${streamId}: ${error.message}`)
        );
      }
    }

    // Shutdown integrated modules (if available)
    if (this.memoryOptimizer) {
      await this.memoryOptimizer.shutdown();
    }
    if (this.parallelProcessor) {
      await this.parallelProcessor.shutdown();
    }
    if (this.batchManager) {
      await this.batchManager.shutdown();
    }
    if (this.skipLogicManager) {
      this.skipLogicManager.shutdown();
    }
    if (this.cache) {
      await this.cache.shutdown();
    }

    // Final metrics report
    const finalMetrics = this.getOverallMetrics();
    console.log(
      chalk.green(
        `✅ StreamProcessor processed ${finalMetrics.itemsProcessed} items across ${finalMetrics.totalStreams} streams`
      )
    );

    this.activeStreams.clear();
  }
}

module.exports = StreamProcessor;
