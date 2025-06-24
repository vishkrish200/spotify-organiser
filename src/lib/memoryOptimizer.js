/**
 * Memory Optimization Module
 *
 * Provides memory monitoring, leak prevention, efficient data structures,
 * and optimization strategies for high-performance memory management
 */

const chalk = require("chalk");
const ErrorHandler = require("../utils/errorHandler");

class MemoryOptimizer {
  constructor(options = {}) {
    // Configuration
    this.config = {
      // Memory monitoring
      monitoringInterval: options.monitoringInterval || 30000, // 30 seconds
      memoryWarningThreshold:
        options.memoryWarningThreshold || 500 * 1024 * 1024, // 500MB
      memoryCriticalThreshold:
        options.memoryCriticalThreshold || 1024 * 1024 * 1024, // 1GB
      gcSuggestThreshold: options.gcSuggestThreshold || 750 * 1024 * 1024, // 750MB

      // Object pooling
      maxPoolSize: options.maxPoolSize || 100,
      enableObjectPooling: options.enableObjectPooling !== false,

      // Cache management
      maxWeakCacheSize: options.maxWeakCacheSize || 1000,
      cacheCleanupInterval: options.cacheCleanupInterval || 60000, // 1 minute

      // Stream processing
      streamBufferSize: options.streamBufferSize || 1024, // 1KB default
      maxConcurrentStreams: options.maxConcurrentStreams || 5,

      // Debugging
      enableDetailedLogging: options.enableDetailedLogging || false,
      enableMemoryProfiling: options.enableMemoryProfiling || false,
    };

    // Memory monitoring state
    this.memoryStats = {
      startTime: Date.now(),
      baselineMemory: process.memoryUsage(),
      currentMemory: process.memoryUsage(),
      peakMemory: process.memoryUsage(),
      gcCount: 0,
      warningCount: 0,
      criticalCount: 0,
      leakWarnings: 0,
    };

    // Object pools for reusable objects
    this.objectPools = new Map();

    // Weak reference caches for automatic cleanup
    this.weakCaches = new Map();

    // Stream management
    this.activeStreams = new Set();
    this.streamMetrics = {
      created: 0,
      completed: 0,
      errors: 0,
      memoryPeak: 0,
    };

    // Cleanup references
    this.cleanupHandlers = new Set();
    this.monitoringInterval = null;
    this.cacheCleanupInterval = null;

    console.log(chalk.green("✅ MemoryOptimizer initialized"));

    // Start monitoring if configured
    if (this.config.monitoringInterval > 0) {
      this.startMemoryMonitoring();
    }
  }

  /**
   * Start memory monitoring and optimization
   */
  startMemoryMonitoring() {
    if (this.monitoringInterval) return; // Already running

    console.log(chalk.blue("📊 Starting memory monitoring..."));

    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.monitoringInterval);

    // Start cache cleanup
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupWeakCaches();
    }, this.config.cacheCleanupInterval);

    // Record baseline memory
    this.memoryStats.baselineMemory = process.memoryUsage();
  }

  /**
   * Stop memory monitoring
   */
  stopMemoryMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }

    console.log(chalk.gray("📊 Memory monitoring stopped"));
  }

  /**
   * Check current memory usage and apply optimizations
   */
  checkMemoryUsage() {
    const currentMemory = process.memoryUsage();
    this.memoryStats.currentMemory = currentMemory;

    // Update peak memory
    if (currentMemory.heapUsed > this.memoryStats.peakMemory.heapUsed) {
      this.memoryStats.peakMemory = currentMemory;
    }

    const heapUsedMB = Math.round(currentMemory.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(currentMemory.heapTotal / 1024 / 1024);

    if (this.config.enableDetailedLogging) {
      console.log(
        chalk.gray(
          `💾 Memory: ${heapUsedMB}MB/${heapTotalMB}MB heap, ${Math.round(
            currentMemory.rss / 1024 / 1024
          )}MB RSS`
        )
      );
    }

    // Check for memory warnings
    if (currentMemory.heapUsed > this.config.memoryCriticalThreshold) {
      this.memoryStats.criticalCount++;
      console.log(
        chalk.red(
          `🚨 CRITICAL: Memory usage ${heapUsedMB}MB exceeds critical threshold!`
        )
      );
      this.triggerEmergencyCleanup();
    } else if (currentMemory.heapUsed > this.config.memoryWarningThreshold) {
      this.memoryStats.warningCount++;
      console.log(
        chalk.yellow(`⚠️ WARNING: High memory usage: ${heapUsedMB}MB`)
      );
      this.triggerMemoryOptimization();
    }

    // Suggest garbage collection if needed
    if (currentMemory.heapUsed > this.config.gcSuggestThreshold) {
      this.suggestGarbageCollection();
    }

    // Check for potential memory leaks
    this.checkForMemoryLeaks();
  }

  /**
   * Trigger memory optimization strategies
   */
  triggerMemoryOptimization() {
    console.log(chalk.blue("🧹 Triggering memory optimization..."));

    // Clean up weak caches
    this.cleanupWeakCaches();

    // Clear object pools if they're too large
    this.optimizeObjectPools();

    // Force cleanup of completed streams
    this.cleanupCompletedStreams();

    // Run registered cleanup handlers
    this.runCleanupHandlers();
  }

  /**
   * Emergency memory cleanup for critical situations
   */
  triggerEmergencyCleanup() {
    console.log(
      chalk.red("🚨 EMERGENCY: Performing aggressive memory cleanup...")
    );

    // Clear all weak caches
    this.clearAllWeakCaches();

    // Clear all object pools
    this.clearAllObjectPools();

    // Terminate all active streams
    this.terminateAllStreams();

    // Force garbage collection if available
    if (global.gc) {
      console.log(chalk.blue("🗑️ Running garbage collection..."));
      global.gc();
      this.memoryStats.gcCount++;
    }

    // Run all cleanup handlers
    this.runCleanupHandlers();
  }

  /**
   * Suggest garbage collection when memory is high
   */
  suggestGarbageCollection() {
    if (global.gc && this.memoryStats.gcCount < 10) {
      // Limit GC calls
      if (this.config.enableDetailedLogging) {
        console.log(chalk.blue("🗑️ Suggesting garbage collection..."));
      }
      global.gc();
      this.memoryStats.gcCount++;
    }
  }

  /**
   * Check for potential memory leaks
   */
  checkForMemoryLeaks() {
    const current = this.memoryStats.currentMemory;
    const baseline = this.memoryStats.baselineMemory;
    const runtime = Date.now() - this.memoryStats.startTime;

    // Check for steady memory growth over time
    if (runtime > 300000) {
      // After 5 minutes
      const growthRatio = current.heapUsed / baseline.heapUsed;

      if (growthRatio > 3.0) {
        // Memory usage tripled
        this.memoryStats.leakWarnings++;
        console.log(
          chalk.yellow(
            `⚠️ Potential memory leak detected: ${growthRatio.toFixed(
              2
            )}x growth`
          )
        );

        if (this.config.enableMemoryProfiling) {
          this.generateMemoryReport();
        }
      }
    }
  }

  /**
   * Create and manage object pools for frequently created objects
   */
  createObjectPool(type, factory, reset = null) {
    if (!this.config.enableObjectPooling) {
      return {
        acquire: factory,
        release: () => {}, // No-op
        size: () => 0,
        clear: () => {},
      };
    }

    const pool = {
      objects: [],
      factory,
      reset,
      created: 0,
      acquired: 0,
      released: 0,
    };

    this.objectPools.set(type, pool);

    return {
      acquire: () => {
        if (pool.objects.length > 0) {
          const obj = pool.objects.pop();
          pool.acquired++;
          return obj;
        } else {
          const obj = pool.factory();
          pool.created++;
          pool.acquired++;
          return obj;
        }
      },

      release: (obj) => {
        if (pool.objects.length < this.config.maxPoolSize) {
          if (pool.reset) {
            pool.reset(obj);
          }
          pool.objects.push(obj);
          pool.released++;
        }
      },

      size: () => pool.objects.length,
      clear: () => {
        pool.objects.length = 0;
      },
    };
  }

  /**
   * Create weak reference cache for automatic cleanup
   */
  createWeakCache(name, maxSize = null) {
    const maxCacheSize = maxSize || this.config.maxWeakCacheSize;

    const cache = {
      data: new Map(),
      weakRefs: new Map(),
      accessOrder: [],
      hits: 0,
      misses: 0,
      evictions: 0,
    };

    this.weakCaches.set(name, cache);

    return {
      get: (key) => {
        const weakRef = cache.weakRefs.get(key);
        if (weakRef) {
          const value = weakRef.deref();
          if (value !== undefined) {
            cache.hits++;
            // Move to end of access order (LRU)
            const index = cache.accessOrder.indexOf(key);
            if (index !== -1) {
              cache.accessOrder.splice(index, 1);
            }
            cache.accessOrder.push(key);
            return value;
          } else {
            // Object was garbage collected
            cache.weakRefs.delete(key);
            cache.data.delete(key);
          }
        }
        cache.misses++;
        return undefined;
      },

      set: (key, value) => {
        // Evict oldest if at capacity
        if (cache.data.size >= maxCacheSize && !cache.data.has(key)) {
          const oldestKey = cache.accessOrder.shift();
          if (oldestKey) {
            cache.data.delete(oldestKey);
            cache.weakRefs.delete(oldestKey);
            cache.evictions++;
          }
        }

        cache.data.set(key, value);
        cache.weakRefs.set(key, new WeakRef(value));

        // Update access order
        const index = cache.accessOrder.indexOf(key);
        if (index !== -1) {
          cache.accessOrder.splice(index, 1);
        }
        cache.accessOrder.push(key);
      },

      delete: (key) => {
        cache.data.delete(key);
        cache.weakRefs.delete(key);
        const index = cache.accessOrder.indexOf(key);
        if (index !== -1) {
          cache.accessOrder.splice(index, 1);
        }
      },

      clear: () => {
        cache.data.clear();
        cache.weakRefs.clear();
        cache.accessOrder.length = 0;
      },

      size: () => cache.data.size,

      stats: () => ({
        size: cache.data.size,
        hits: cache.hits,
        misses: cache.misses,
        evictions: cache.evictions,
        hitRate: cache.hits / (cache.hits + cache.misses) || 0,
      }),
    };
  }

  /**
   * Create memory-efficient stream processor
   */
  createMemoryEfficientStream(processor, options = {}) {
    const streamId = `stream_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const bufferSize = options.bufferSize || this.config.streamBufferSize;

    const stream = {
      id: streamId,
      processor,
      buffer: [],
      bufferSize,
      processed: 0,
      errors: 0,
      startTime: Date.now(),
      peakMemory: 0,
      isActive: true,
    };

    this.activeStreams.add(stream);
    this.streamMetrics.created++;

    return {
      push: async (item) => {
        if (!stream.isActive) {
          throw new Error("Stream has been terminated");
        }

        stream.buffer.push(item);

        // Process buffer when it reaches capacity
        if (stream.buffer.length >= stream.bufferSize) {
          await this.flushStreamBuffer(stream);
        }

        // Monitor memory usage
        const currentMemory = process.memoryUsage().heapUsed;
        if (currentMemory > stream.peakMemory) {
          stream.peakMemory = currentMemory;
        }
      },

      flush: async () => {
        if (stream.buffer.length > 0) {
          await this.flushStreamBuffer(stream);
        }
      },

      finish: async () => {
        await this.finishStream(stream);
      },

      terminate: () => {
        this.terminateStream(stream);
      },

      stats: () => ({
        id: stream.id,
        processed: stream.processed,
        errors: stream.errors,
        bufferSize: stream.buffer.length,
        runtime: Date.now() - stream.startTime,
        peakMemory: stream.peakMemory,
        isActive: stream.isActive,
      }),
    };
  }

  /**
   * Flush stream buffer and process items
   */
  async flushStreamBuffer(stream) {
    if (stream.buffer.length === 0) return;

    try {
      const items = stream.buffer.splice(0, stream.bufferSize);
      await stream.processor(items);
      stream.processed += items.length;
    } catch (error) {
      stream.errors++;
      console.log(
        chalk.yellow(
          `⚠️ Stream ${stream.id} processing error: ${error.message}`
        )
      );
    }
  }

  /**
   * Finish stream processing
   */
  async finishStream(stream) {
    // Process remaining buffer
    await this.flushStreamBuffer(stream);

    // Mark as inactive
    stream.isActive = false;

    // Remove from active streams
    this.activeStreams.delete(stream);
    this.streamMetrics.completed++;

    console.log(
      chalk.green(
        `✅ Stream ${stream.id} completed: ${stream.processed} items processed`
      )
    );
  }

  /**
   * Terminate stream immediately
   */
  terminateStream(stream) {
    stream.isActive = false;
    stream.buffer.length = 0; // Clear buffer
    this.activeStreams.delete(stream);
    this.streamMetrics.errors++;
  }

  /**
   * Cleanup weak caches
   */
  cleanupWeakCaches() {
    let totalCleaned = 0;

    for (const [name, cache] of this.weakCaches) {
      const sizeBefore = cache.data.size;

      // Clean up dead weak references
      for (const [key, weakRef] of cache.weakRefs) {
        if (weakRef.deref() === undefined) {
          cache.data.delete(key);
          cache.weakRefs.delete(key);
          const index = cache.accessOrder.indexOf(key);
          if (index !== -1) {
            cache.accessOrder.splice(index, 1);
          }
        }
      }

      const cleaned = sizeBefore - cache.data.size;
      totalCleaned += cleaned;

      if (cleaned > 0 && this.config.enableDetailedLogging) {
        console.log(
          chalk.gray(`🧹 Cleaned ${cleaned} entries from cache '${name}'`)
        );
      }
    }

    if (totalCleaned > 0) {
      console.log(chalk.green(`✅ Cleaned ${totalCleaned} weak cache entries`));
    }
  }

  /**
   * Optimize object pools
   */
  optimizeObjectPools() {
    for (const [type, pool] of this.objectPools) {
      if (pool.objects.length > this.config.maxPoolSize * 0.8) {
        const toRemove = Math.floor(pool.objects.length * 0.3);
        pool.objects.splice(0, toRemove);

        if (this.config.enableDetailedLogging) {
          console.log(
            chalk.gray(
              `🧹 Optimized object pool '${type}': removed ${toRemove} objects`
            )
          );
        }
      }
    }
  }

  /**
   * Cleanup completed streams
   */
  cleanupCompletedStreams() {
    const completed = [];

    for (const stream of this.activeStreams) {
      if (!stream.isActive) {
        completed.push(stream);
      }
    }

    for (const stream of completed) {
      this.activeStreams.delete(stream);
    }

    if (completed.length > 0) {
      console.log(
        chalk.green(`✅ Cleaned up ${completed.length} completed streams`)
      );
    }
  }

  /**
   * Clear all weak caches
   */
  clearAllWeakCaches() {
    let totalCleared = 0;

    for (const [name, cache] of this.weakCaches) {
      const size = cache.data.size;
      cache.data.clear();
      cache.weakRefs.clear();
      cache.accessOrder.length = 0;
      totalCleared += size;
    }

    if (totalCleared > 0) {
      console.log(
        chalk.yellow(`🧹 Emergency: Cleared ${totalCleared} cache entries`)
      );
    }
  }

  /**
   * Clear all object pools
   */
  clearAllObjectPools() {
    let totalCleared = 0;

    for (const [type, pool] of this.objectPools) {
      totalCleared += pool.objects.length;
      pool.objects.length = 0;
    }

    if (totalCleared > 0) {
      console.log(
        chalk.yellow(`🧹 Emergency: Cleared ${totalCleared} pooled objects`)
      );
    }
  }

  /**
   * Terminate all active streams
   */
  terminateAllStreams() {
    const count = this.activeStreams.size;

    for (const stream of this.activeStreams) {
      this.terminateStream(stream);
    }

    if (count > 0) {
      console.log(
        chalk.yellow(`🧹 Emergency: Terminated ${count} active streams`)
      );
    }
  }

  /**
   * Register cleanup handler
   */
  registerCleanupHandler(handler) {
    this.cleanupHandlers.add(handler);
  }

  /**
   * Unregister cleanup handler
   */
  unregisterCleanupHandler(handler) {
    this.cleanupHandlers.delete(handler);
  }

  /**
   * Run all registered cleanup handlers
   */
  runCleanupHandlers() {
    for (const handler of this.cleanupHandlers) {
      try {
        handler();
      } catch (error) {
        console.log(chalk.yellow(`⚠️ Cleanup handler error: ${error.message}`));
      }
    }
  }

  /**
   * Generate detailed memory report
   */
  generateMemoryReport() {
    const current = process.memoryUsage();
    const runtime = Date.now() - this.memoryStats.startTime;

    const report = {
      timestamp: new Date().toISOString(),
      runtime: Math.round(runtime / 1000) + "s",
      memory: {
        current: {
          heapUsed: Math.round(current.heapUsed / 1024 / 1024) + "MB",
          heapTotal: Math.round(current.heapTotal / 1024 / 1024) + "MB",
          rss: Math.round(current.rss / 1024 / 1024) + "MB",
          external: Math.round(current.external / 1024 / 1024) + "MB",
        },
        peak: {
          heapUsed:
            Math.round(this.memoryStats.peakMemory.heapUsed / 1024 / 1024) +
            "MB",
        },
        baseline: {
          heapUsed:
            Math.round(this.memoryStats.baselineMemory.heapUsed / 1024 / 1024) +
            "MB",
        },
      },
      caches: {},
      objectPools: {},
      streams: {
        active: this.activeStreams.size,
        ...this.streamMetrics,
      },
      optimization: {
        gcCount: this.memoryStats.gcCount,
        warningCount: this.memoryStats.warningCount,
        criticalCount: this.memoryStats.criticalCount,
        leakWarnings: this.memoryStats.leakWarnings,
      },
    };

    // Cache statistics
    for (const [name, cache] of this.weakCaches) {
      report.caches[name] = {
        size: cache.data.size,
        hits: cache.hits,
        misses: cache.misses,
        hitRate: (cache.hits / (cache.hits + cache.misses) || 0).toFixed(2),
      };
    }

    // Object pool statistics
    for (const [type, pool] of this.objectPools) {
      report.objectPools[type] = {
        pooled: pool.objects.length,
        created: pool.created,
        acquired: pool.acquired,
        released: pool.released,
        efficiency:
          pool.released > 0
            ? (pool.released / pool.created).toFixed(2)
            : "0.00",
      };
    }

    console.log(chalk.blue("📊 Memory Report:"));
    console.log(JSON.stringify(report, null, 2));

    return report;
  }

  /**
   * Get current memory statistics
   */
  getStats() {
    return {
      memory: this.memoryStats,
      caches: Array.from(this.weakCaches.keys()),
      objectPools: Array.from(this.objectPools.keys()),
      activeStreams: this.activeStreams.size,
      streamMetrics: this.streamMetrics,
    };
  }

  /**
   * Shutdown memory optimizer and cleanup resources
   */
  async shutdown() {
    console.log(chalk.gray("📤 MemoryOptimizer shutdown"));

    // Stop monitoring
    this.stopMemoryMonitoring();

    // Cleanup all resources
    this.clearAllWeakCaches();
    this.clearAllObjectPools();
    this.terminateAllStreams();

    // Run final cleanup
    this.runCleanupHandlers();

    // Clear cleanup handlers
    this.cleanupHandlers.clear();

    console.log(chalk.gray("✅ Memory optimizer cleaned up"));
  }
}

module.exports = MemoryOptimizer;
