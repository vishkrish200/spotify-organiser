/**
 * Parallel Processing Manager Module
 *
 * Provides intelligent parallel processing for both CPU-intensive operations
 * using worker threads and I/O-bound operations using concurrent async execution
 */

const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");
const os = require("os");
const chalk = require("chalk");
const ErrorHandler = require("../utils/errorHandler");

class ParallelProcessor {
  constructor(options = {}) {
    // Configuration
    this.config = {
      // Worker thread settings
      maxWorkers: options.maxWorkers || Math.min(os.cpus().length, 4),
      workerTimeout: options.workerTimeout || 30000, // 30 seconds
      workerIdleTimeout: options.workerIdleTimeout || 60000, // 1 minute

      // Concurrent async settings
      maxConcurrentAsync: options.maxConcurrentAsync || 10,
      asyncTimeout: options.asyncTimeout || 15000, // 15 seconds

      // Performance settings
      enableMetrics: options.enableMetrics !== false,
      chunkSize: options.chunkSize || 100, // Default chunk size for parallel processing
      adaptiveChunking: options.adaptiveChunking !== false,
    };

    // Worker pool management
    this.workers = new Map();
    this.availableWorkers = [];
    this.workerTasks = new Map();
    this.workerMetrics = new Map();

    // Async operation management
    this.activeTasks = new Set();
    this.taskQueue = [];

    // Performance tracking
    this.metrics = {
      workerTasksCompleted: 0,
      asyncTasksCompleted: 0,
      totalProcessingTime: 0,
      avgTaskTime: 0,
      parallelizationRatio: 0,
      errorCount: 0,
    };

    // Resource monitoring
    this.resourceMonitor = {
      cpuUsage: 0,
      memoryUsage: 0,
      lastCheck: Date.now(),
    };

    console.log(
      chalk.green(
        `✅ ParallelProcessor initialized (${this.config.maxWorkers} workers)`
      )
    );
  }

  /**
   * Process array of items in parallel using worker threads for CPU-intensive tasks
   */
  async processWithWorkers(items, processingFunction, options = {}) {
    const startTime = Date.now();

    if (!items || items.length === 0) {
      return [];
    }

    const {
      chunkSize = this.getOptimalChunkSize(items.length),
      timeout = this.config.workerTimeout,
      retries = 2,
    } = options;

    try {
      console.log(
        chalk.blue(
          `🔄 Processing ${items.length} items with ${this.config.maxWorkers} workers`
        )
      );

      // Split items into chunks for parallel processing
      const chunks = this.chunkArray(items, chunkSize);
      const results = [];

      // Process chunks in parallel
      const chunkPromises = chunks.map(async (chunk, index) => {
        const worker = await this.getAvailableWorker();

        try {
          const chunkResult = await this.executeWorkerTask(
            worker,
            {
              chunk,
              processingFunction: processingFunction.toString(),
              chunkIndex: index,
            },
            timeout
          );

          this.releaseWorker(worker);
          return chunkResult;
        } catch (error) {
          this.releaseWorker(worker);

          // Retry logic for failed chunks
          if (retries > 0) {
            console.log(chalk.yellow(`⚠️ Retrying chunk ${index}...`));
            return this.processWithWorkers([chunk], processingFunction, {
              ...options,
              retries: retries - 1,
            });
          }

          throw error;
        }
      });

      // Wait for all chunks to complete
      const chunkResults = await Promise.all(chunkPromises);

      // Flatten results
      for (const chunkResult of chunkResults) {
        if (Array.isArray(chunkResult)) {
          results.push(...chunkResult);
        } else {
          results.push(chunkResult);
        }
      }

      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updateMetrics("worker", items.length, processingTime);

      console.log(
        chalk.green(
          `✅ Worker processing completed: ${items.length} items in ${processingTime}ms`
        )
      );

      return results;
    } catch (error) {
      this.metrics.errorCount++;
      ErrorHandler.handleGenericError(error, "Worker Processing");
      throw error;
    }
  }

  /**
   * Process array of async operations with controlled concurrency
   */
  async processAsync(items, asyncFunction, options = {}) {
    const startTime = Date.now();

    if (!items || items.length === 0) {
      return [];
    }

    const {
      concurrency = this.config.maxConcurrentAsync,
      timeout = this.config.asyncTimeout,
      retries = 2,
      preserveOrder = true,
    } = options;

    try {
      console.log(
        chalk.blue(
          `⚡ Processing ${items.length} async operations (${concurrency} concurrent)`
        )
      );

      const results = preserveOrder ? new Array(items.length) : [];
      const inProgress = new Set();
      let completed = 0;
      let itemIndex = 0;

      // Process items with controlled concurrency
      const processNextBatch = async () => {
        const promises = [];

        // Start up to 'concurrency' new tasks
        while (inProgress.size < concurrency && itemIndex < items.length) {
          const currentIndex = itemIndex++;
          const item = items[currentIndex];

          const taskPromise = this.executeAsyncTask(
            item,
            asyncFunction,
            currentIndex,
            timeout,
            retries
          );

          inProgress.add(taskPromise);
          promises.push(taskPromise);

          // Handle task completion
          taskPromise
            .then((result) => {
              if (preserveOrder) {
                results[currentIndex] = result;
              } else {
                results.push(result);
              }
              completed++;
            })
            .catch((error) => {
              console.log(
                chalk.yellow(`⚠️ Task ${currentIndex} failed: ${error.message}`)
              );
              if (preserveOrder) {
                results[currentIndex] = null;
              }
              completed++;
              this.metrics.errorCount++;
            })
            .finally(() => {
              inProgress.delete(taskPromise);
            });
        }

        return promises;
      };

      // Execute all tasks with controlled concurrency
      while (completed < items.length) {
        const batch = await processNextBatch();
        if (batch.length > 0) {
          await Promise.race(batch);
        }
      }

      // Wait for any remaining tasks
      if (inProgress.size > 0) {
        await Promise.all(Array.from(inProgress));
      }

      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updateMetrics("async", items.length, processingTime);

      console.log(
        chalk.green(
          `✅ Async processing completed: ${items.length} operations in ${processingTime}ms`
        )
      );

      return results.filter((result) => result !== null);
    } catch (error) {
      this.metrics.errorCount++;
      ErrorHandler.handleGenericError(error, "Async Processing");
      throw error;
    }
  }

  /**
   * Execute a mixed workload with both parallel and async processing
   */
  async processMixed(workload, options = {}) {
    const {
      cpuTasks = [],
      ioTasks = [],
      sequentialTasks = [],
      waitForAll = true,
    } = workload;

    const promises = [];

    try {
      // Start CPU-intensive tasks with workers
      if (cpuTasks.length > 0) {
        const cpuPromise = this.processWithWorkers(
          cpuTasks.items,
          cpuTasks.processor,
          cpuTasks.options
        );
        promises.push(cpuPromise);
      }

      // Start I/O-bound tasks with async concurrency
      if (ioTasks.length > 0) {
        const ioPromise = this.processAsync(
          ioTasks.items,
          ioTasks.processor,
          ioTasks.options
        );
        promises.push(ioPromise);
      }

      // Execute sequential tasks (after parallel ones if needed)
      let sequentialResult = null;
      if (sequentialTasks.length > 0) {
        if (waitForAll && promises.length > 0) {
          await Promise.all(promises);
        }

        for (const task of sequentialTasks) {
          sequentialResult = await task.processor(task.data, task.options);
        }
      }

      // Wait for all parallel tasks to complete
      const parallelResults =
        waitForAll && promises.length > 0
          ? await Promise.all(promises)
          : await Promise.allSettled(promises);

      return {
        cpu: parallelResults[0] || [],
        io: parallelResults[1] || [],
        sequential: sequentialResult,
      };
    } catch (error) {
      ErrorHandler.handleGenericError(error, "Mixed Processing");
      throw error;
    }
  }

  /**
   * Get or create an available worker
   */
  async getAvailableWorker() {
    // Check for available worker
    if (this.availableWorkers.length > 0) {
      return this.availableWorkers.pop();
    }

    // Create new worker if under limit
    if (this.workers.size < this.config.maxWorkers) {
      return this.createWorker();
    }

    // Wait for worker to become available
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.availableWorkers.length > 0) {
          clearInterval(checkInterval);
          resolve(this.availableWorkers.pop());
        }
      }, 10);
    });
  }

  /**
   * Create a new worker thread
   */
  createWorker() {
    const workerId = `worker_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Create worker with inline processing function
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('worker_threads');
      
      parentPort.on('message', async (data) => {
        try {
          const { chunk, processingFunction, chunkIndex } = data;
          
          // Create function from string
          const processor = new Function('return ' + processingFunction)();
          
          // Process the chunk
          const result = await processor(chunk, chunkIndex);
          
          parentPort.postMessage({ success: true, result });
        } catch (error) {
          parentPort.postMessage({ 
            success: false, 
            error: error.message,
            stack: error.stack 
          });
        }
      });
    `,
      { eval: true }
    );

    // Set up worker metadata
    this.workers.set(workerId, worker);
    this.workerMetrics.set(workerId, {
      tasksCompleted: 0,
      totalTime: 0,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });

    // Handle worker errors
    worker.on("error", (error) => {
      console.log(chalk.red(`❌ Worker ${workerId} error: ${error.message}`));
      this.removeWorker(workerId);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        console.log(
          chalk.yellow(`⚠️ Worker ${workerId} exited with code ${code}`)
        );
      }
      this.removeWorker(workerId);
    });

    return { id: workerId, worker };
  }

  /**
   * Execute a task on a worker
   */
  async executeWorkerTask(workerInfo, taskData, timeout) {
    const { id, worker } = workerInfo;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Worker task timeout after ${timeout}ms`));
      }, timeout);

      worker.once("message", (response) => {
        clearTimeout(timeoutId);

        const processingTime = Date.now() - startTime;

        // Update worker metrics
        const metrics = this.workerMetrics.get(id);
        if (metrics) {
          metrics.tasksCompleted++;
          metrics.totalTime += processingTime;
          metrics.lastUsed = Date.now();
        }

        if (response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response.error));
        }
      });

      worker.postMessage(taskData);
    });
  }

  /**
   * Execute an async task with timeout and retry logic
   */
  async executeAsyncTask(item, asyncFunction, index, timeout, retries) {
    const executeOnce = async () => {
      return new Promise(async (resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`Async task timeout after ${timeout}ms`));
        }, timeout);

        try {
          const result = await asyncFunction(item, index);
          clearTimeout(timeoutId);
          resolve(result);
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
    };

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await executeOnce();
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          console.log(
            chalk.yellow(`⚠️ Retry ${attempt + 1}/${retries} for task ${index}`)
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * Math.pow(2, attempt))
          );
        }
      }
    }

    throw lastError;
  }

  /**
   * Release worker back to the pool
   */
  releaseWorker(workerInfo) {
    if (this.availableWorkers.length < this.config.maxWorkers) {
      this.availableWorkers.push(workerInfo);
    } else {
      // Too many workers, terminate this one
      this.removeWorker(workerInfo.id);
    }
  }

  /**
   * Remove and terminate a worker
   */
  removeWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.terminate();
      this.workers.delete(workerId);
      this.workerMetrics.delete(workerId);

      // Remove from available workers if present
      this.availableWorkers = this.availableWorkers.filter(
        (w) => w.id !== workerId
      );
    }
  }

  /**
   * Get optimal chunk size based on data size and system resources
   */
  getOptimalChunkSize(totalItems) {
    if (!this.config.adaptiveChunking) {
      return this.config.chunkSize;
    }

    // Adaptive chunking based on total items and worker count
    const baseChunkSize = Math.ceil(totalItems / (this.config.maxWorkers * 2));
    const minChunkSize = Math.max(1, Math.floor(totalItems / 100));
    const maxChunkSize = Math.min(this.config.chunkSize * 2, totalItems);

    return Math.max(minChunkSize, Math.min(maxChunkSize, baseChunkSize));
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
   * Update performance metrics
   */
  updateMetrics(type, itemCount, processingTime) {
    if (type === "worker") {
      this.metrics.workerTasksCompleted += itemCount;
    } else {
      this.metrics.asyncTasksCompleted += itemCount;
    }

    this.metrics.totalProcessingTime += processingTime;
    const totalTasks =
      this.metrics.workerTasksCompleted + this.metrics.asyncTasksCompleted;

    if (totalTasks > 0) {
      this.metrics.avgTaskTime = this.metrics.totalProcessingTime / totalTasks;
      this.metrics.parallelizationRatio = (itemCount / processingTime) * 1000; // items per second
    }
  }

  /**
   * Get current performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeWorkers: this.workers.size,
      availableWorkers: this.availableWorkers.length,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
    };
  }

  /**
   * Cleanup and shutdown all workers
   */
  async shutdown() {
    console.log(chalk.gray("📤 ParallelProcessor shutdown"));

    // Terminate all workers
    const terminationPromises = [];
    for (const [workerId, worker] of this.workers) {
      terminationPromises.push(worker.terminate());
    }

    await Promise.all(terminationPromises);

    // Clear data structures
    this.workers.clear();
    this.availableWorkers.length = 0;
    this.workerTasks.clear();
    this.workerMetrics.clear();
    this.activeTasks.clear();
    this.taskQueue.length = 0;

    console.log(chalk.gray("✅ All workers terminated"));
  }
}

module.exports = ParallelProcessor;
