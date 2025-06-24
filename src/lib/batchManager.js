/**
 * Batch Request Manager Module
 *
 * Provides intelligent request batching, deduplication, and optimization
 * for Spotify API calls to maximize throughput and minimize rate limiting
 */

const chalk = require("chalk");
const ErrorHandler = require("../utils/errorHandler");

class BatchManager {
  constructor(options = {}) {
    // Configuration
    this.config = {
      // Batch size configurations (API-specific limits)
      maxBatchSizes: {
        tracks: 50, // Spotify saved tracks API limit
        artists: 50, // Spotify artists API limit
        audioFeatures: 100, // Spotify audio features API limit (optimized)
        albums: 20, // Spotify albums API limit
        search: 50, // General search operations
      },

      // Timing configurations
      batchFlushInterval: options.batchFlushInterval || 100, // ms
      maxBatchWaitTime: options.maxBatchWaitTime || 500, // ms
      adaptiveSizingEnabled: options.adaptiveSizingEnabled !== false,

      // Rate limiting
      maxConcurrentBatches: options.maxConcurrentBatches || 5,
      rateLimitBuffer: options.rateLimitBuffer || 0.8, // Use 80% of rate limit

      // Performance monitoring
      enableMetrics: options.enableMetrics !== false,
      performanceWindow: options.performanceWindow || 10000, // 10 seconds
    };

    // Batch queues for different request types
    this.queues = {
      tracks: new Map(),
      artists: new Map(),
      audioFeatures: new Map(),
      albums: new Map(),
      search: new Map(),
    };

    // Request deduplication
    this.pendingRequests = new Map();
    this.requestCache = new Map();

    // Performance tracking
    this.metrics = {
      batchesProcessed: 0,
      requestsDeduped: 0,
      totalRequests: 0,
      avgBatchSize: 0,
      avgResponseTime: 0,
      rateLimitHits: 0,
      performanceHistory: [],
    };

    // Active batch tracking
    this.activeBatches = new Set();
    this.batchTimers = new Map();

    // Adaptive sizing data
    this.performanceData = new Map();

    console.log(chalk.green("✅ BatchManager initialized"));
  }

  /**
   * Add request to appropriate batch queue
   */
  async addRequest(requestType, requestId, fetchFunction, priority = "normal") {
    const queueKey = `${requestType}_${priority}`;

    // Check for duplicate requests
    if (this.pendingRequests.has(requestId)) {
      this.metrics.requestsDeduped++;
      return this.pendingRequests.get(requestId);
    }

    // Create promise for this request
    const requestPromise = new Promise((resolve, reject) => {
      if (!this.queues[requestType]) {
        this.queues[requestType] = new Map();
      }

      const queue = this.queues[requestType];

      if (!queue.has(queueKey)) {
        queue.set(queueKey, {
          items: [],
          fetchFunction,
          priority,
          createdAt: Date.now(),
        });
      }

      // Add to queue
      queue.get(queueKey).items.push({
        id: requestId,
        resolve,
        reject,
        addedAt: Date.now(),
      });

      // Schedule batch processing
      this.scheduleBatchProcessing(requestType, queueKey);
    });

    // Track pending request
    this.pendingRequests.set(requestId, requestPromise);
    this.metrics.totalRequests++;

    return requestPromise;
  }

  /**
   * Add multiple requests as a batch
   */
  async addBatchRequest(
    requestType,
    requestIds,
    fetchFunction,
    priority = "normal"
  ) {
    const promises = [];

    // Deduplicate requests
    const uniqueIds = [...new Set(requestIds)];
    const newIds = uniqueIds.filter((id) => !this.pendingRequests.has(id));

    this.metrics.requestsDeduped += uniqueIds.length - newIds.length;

    if (newIds.length === 0) {
      // All requests are duplicates, return existing promises
      return Promise.all(uniqueIds.map((id) => this.pendingRequests.get(id)));
    }

    // Process new requests
    const batchPromise = new Promise(async (resolve, reject) => {
      try {
        const results = await this.processBatch(
          requestType,
          newIds,
          fetchFunction
        );

        // Resolve individual requests
        results.forEach((result, index) => {
          const id = newIds[index];
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
          }
        });

        resolve(results);
      } catch (error) {
        // Reject individual requests
        newIds.forEach((id) => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
          }
        });
        reject(error);
      }
    });

    // Track all requests (new and existing)
    return Promise.all(
      uniqueIds.map(
        (id) =>
          this.pendingRequests.get(id) ||
          batchPromise.then((results) => results[newIds.indexOf(id)])
      )
    );
  }

  /**
   * Schedule batch processing with intelligent timing
   */
  scheduleBatchProcessing(requestType, queueKey) {
    const timerId = `${requestType}_${queueKey}`;

    // Clear existing timer
    if (this.batchTimers.has(timerId)) {
      clearTimeout(this.batchTimers.get(timerId));
    }

    // Calculate optimal batch timing
    const queue = this.queues[requestType].get(queueKey);
    const maxBatchSize = this.getOptimalBatchSize(requestType);
    const queueAge = Date.now() - queue.createdAt;

    let delay = this.config.batchFlushInterval;

    // Immediate processing conditions
    if (
      queue.items.length >= maxBatchSize ||
      queueAge > this.config.maxBatchWaitTime ||
      queue.priority === "high"
    ) {
      delay = 0;
    }

    // Schedule processing
    const timer = setTimeout(() => {
      this.processBatchQueue(requestType, queueKey);
      this.batchTimers.delete(timerId);
    }, delay);

    this.batchTimers.set(timerId, timer);
  }

  /**
   * Process a batch queue
   */
  async processBatchQueue(requestType, queueKey) {
    const queue = this.queues[requestType].get(queueKey);
    if (!queue || queue.items.length === 0) return;

    const batchId = `${requestType}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    this.activeBatches.add(batchId);

    try {
      console.log(
        chalk.blue(
          `📦 Processing ${requestType} batch: ${queue.items.length} items`
        )
      );

      const startTime = Date.now();
      const maxBatchSize = this.getOptimalBatchSize(requestType);

      // Split into optimal batches if needed
      const batches = this.chunkArray(queue.items, maxBatchSize);

      for (const batch of batches) {
        const ids = batch.map((item) => item.id);

        try {
          const results = await queue.fetchFunction(ids);

          // Resolve individual promises
          batch.forEach((item, index) => {
            const result = results[index] || null;
            item.resolve(result);
            this.pendingRequests.delete(item.id);
          });

          // Update metrics
          this.updatePerformanceMetrics(
            requestType,
            batch.length,
            Date.now() - startTime
          );
        } catch (error) {
          console.log(
            chalk.yellow(`⚠️ Batch ${requestType} failed: ${error.message}`)
          );

          // Reject individual promises
          batch.forEach((item) => {
            item.reject(error);
            this.pendingRequests.delete(item.id);
          });

          ErrorHandler.handleNetworkError(error, `Batch ${requestType}`);
        }
      }

      // Clear processed queue
      this.queues[requestType].delete(queueKey);
      this.metrics.batchesProcessed++;
    } finally {
      this.activeBatches.delete(batchId);
    }
  }

  /**
   * Process a single batch directly
   */
  async processBatch(requestType, ids, fetchFunction) {
    const startTime = Date.now();
    const maxBatchSize = this.getOptimalBatchSize(requestType);

    if (ids.length <= maxBatchSize) {
      // Single batch
      const results = await fetchFunction(ids);
      this.updatePerformanceMetrics(
        requestType,
        ids.length,
        Date.now() - startTime
      );
      return results;
    } else {
      // Multiple batches
      const batches = this.chunkArray(ids, maxBatchSize);
      const allResults = [];

      for (const batch of batches) {
        const batchStartTime = Date.now();
        const results = await fetchFunction(batch);
        allResults.push(...results);

        this.updatePerformanceMetrics(
          requestType,
          batch.length,
          Date.now() - batchStartTime
        );

        // Small delay between batches to avoid rate limiting
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      return allResults;
    }
  }

  /**
   * Get optimal batch size with adaptive sizing
   */
  getOptimalBatchSize(requestType) {
    let baseSize = this.config.maxBatchSizes[requestType] || 50;

    if (!this.config.adaptiveSizingEnabled) {
      return baseSize;
    }

    // Use performance data to adjust batch size
    const perfData = this.performanceData.get(requestType);
    if (perfData && perfData.samples.length >= 5) {
      const avgResponseTime =
        perfData.samples.reduce((a, b) => a + b.responseTime, 0) /
        perfData.samples.length;
      const errorRate =
        perfData.samples.reduce((a, b) => a + (b.hadError ? 1 : 0), 0) /
        perfData.samples.length;

      // Reduce batch size if response times are high or error rate is high
      if (avgResponseTime > 2000 || errorRate > 0.1) {
        baseSize = Math.max(Math.floor(baseSize * 0.7), 10);
      }
      // Increase batch size if performance is good
      else if (avgResponseTime < 1000 && errorRate < 0.05) {
        baseSize = Math.min(
          Math.floor(baseSize * 1.2),
          this.config.maxBatchSizes[requestType]
        );
      }
    }

    return baseSize;
  }

  /**
   * Update performance metrics for adaptive sizing
   */
  updatePerformanceMetrics(requestType, batchSize, responseTime) {
    if (!this.performanceData.has(requestType)) {
      this.performanceData.set(requestType, {
        samples: [],
        lastCleanup: Date.now(),
      });
    }

    const perfData = this.performanceData.get(requestType);

    // Add sample
    perfData.samples.push({
      batchSize,
      responseTime,
      timestamp: Date.now(),
      hadError: false,
    });

    // Clean old samples (keep only last 10 minutes)
    const cutoff = Date.now() - this.config.performanceWindow;
    perfData.samples = perfData.samples.filter((s) => s.timestamp > cutoff);

    // Update global metrics
    this.metrics.avgResponseTime =
      (this.metrics.avgResponseTime + responseTime) / 2;
    this.metrics.avgBatchSize = (this.metrics.avgBatchSize + batchSize) / 2;
  }

  /**
   * Utility function to chunk arrays
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Check if we're approaching rate limits
   */
  checkRateLimit(requestType) {
    // This is a placeholder - would integrate with actual Spotify rate limit headers
    const perfData = this.performanceData.get(requestType);
    if (perfData) {
      const recentSamples = perfData.samples.filter(
        (s) => s.timestamp > Date.now() - 60000
      );
      const requestsPerMinute = recentSamples.length;

      // Conservative rate limiting (Spotify allows ~100 requests per minute)
      return requestsPerMinute > 80;
    }
    return false;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    const activeQueues = Object.entries(this.queues).reduce(
      (total, [type, queues]) => {
        return (
          total +
          Array.from(queues.values()).reduce(
            (sum, queue) => sum + queue.items.length,
            0
          )
        );
      },
      0
    );

    return {
      ...this.metrics,
      activeQueues,
      activeBatches: this.activeBatches.size,
      pendingRequests: this.pendingRequests.size,
      cacheHitRate:
        this.metrics.totalRequests > 0
          ? (
              (this.metrics.requestsDeduped / this.metrics.totalRequests) *
              100
            ).toFixed(1) + "%"
          : "0%",
    };
  }

  /**
   * Clear all pending batches and metrics
   */
  async clearAll() {
    // Clear timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    // Clear queues
    for (const queueMap of Object.values(this.queues)) {
      queueMap.clear();
    }

    // Clear pending requests
    this.pendingRequests.clear();
    this.requestCache.clear();

    // Reset metrics
    this.metrics = {
      batchesProcessed: 0,
      requestsDeduped: 0,
      totalRequests: 0,
      avgBatchSize: 0,
      avgResponseTime: 0,
      rateLimitHits: 0,
      performanceHistory: [],
    };

    console.log(chalk.green("✅ BatchManager cleared"));
  }

  /**
   * Shutdown batch manager
   */
  async shutdown() {
    console.log(chalk.gray("📤 BatchManager shutdown"));
    await this.clearAll();
  }
}

module.exports = BatchManager;
