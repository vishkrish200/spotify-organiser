/**
 * Skip Logic Manager Module
 *
 * Implements intelligent conditional processing to skip unnecessary operations
 * based on cache state, data freshness, dependencies, and processing conditions
 */

const chalk = require("chalk");
const ErrorHandler = require("../utils/errorHandler");

class SkipLogicManager {
  constructor(options = {}) {
    // Configuration
    this.config = {
      // Cache freshness thresholds (in milliseconds)
      defaultCacheTTL: options.defaultCacheTTL || 30 * 60 * 1000, // 30 minutes
      analysisCacheTTL: options.analysisCacheTTL || 60 * 60 * 1000, // 1 hour
      metadataCacheTTL: options.metadataCacheTTL || 24 * 60 * 60 * 1000, // 24 hours

      // Processing conditions
      minBatchSize: options.minBatchSize || 10, // Skip processing if batch too small
      maxAge: options.maxAge || 7 * 24 * 60 * 60 * 1000, // 7 days max age
      incrementalThreshold: options.incrementalThreshold || 0.1, // 10% change threshold

      // Performance thresholds
      skipUnderMemoryUsage: options.skipUnderMemoryUsage || 100 * 1024 * 1024, // 100MB
      skipUnderCpuUsage: options.skipUnderCpuUsage || 50, // 50% CPU usage

      // Debugging
      enableDetailedLogging: options.enableDetailedLogging || false,
      enableSkipMetrics: options.enableSkipMetrics !== false,
    };

    // Skip logic state
    this.skipState = {
      lastProcessingTimes: new Map(),
      dataChecksums: new Map(),
      dependencyStates: new Map(),
      processingFlags: new Map(),
      skipReasons: new Map(),
    };

    // Skip metrics for performance analysis
    this.metrics = {
      totalChecks: 0,
      skippedOperations: 0,
      reasonCounts: new Map(),
      timeSaved: 0,
      lastReset: Date.now(),
    };

    console.log(chalk.green("✅ SkipLogicManager initialized"));
  }

  /**
   * Check if operation should be skipped based on cache freshness
   */
  shouldSkipCachedOperation(operationId, cacheData, customTTL = null) {
    this.metrics.totalChecks++;

    if (!cacheData) {
      this.logSkipDecision(operationId, false, "no-cache-data");
      return { skip: false, reason: "No cached data available" };
    }

    const ttl = customTTL || this.config.defaultCacheTTL;
    const age = Date.now() - cacheData.timestamp;

    if (age < ttl) {
      this.recordSkip(operationId, "cache-fresh", age);
      this.logSkipDecision(
        operationId,
        true,
        `cache-fresh (${Math.round(age / 1000)}s old)`
      );
      return {
        skip: true,
        reason: `Cache is fresh (${Math.round(age / 1000)}s < ${Math.round(
          ttl / 1000
        )}s)`,
        data: cacheData.value,
      };
    }

    this.logSkipDecision(
      operationId,
      false,
      `cache-stale (${Math.round(age / 1000)}s old)`
    );
    return {
      skip: false,
      reason: `Cache is stale (${Math.round(age / 1000)}s old)`,
    };
  }

  /**
   * Check if batch operation should be skipped based on size and conditions
   */
  shouldSkipBatchOperation(operationId, batchData, options = {}) {
    this.metrics.totalChecks++;

    // Check minimum batch size
    if (batchData.length < this.config.minBatchSize) {
      this.recordSkip(operationId, "batch-too-small", 0);
      this.logSkipDecision(
        operationId,
        true,
        `batch-too-small (${batchData.length} < ${this.config.minBatchSize})`
      );
      return {
        skip: true,
        reason: `Batch too small (${batchData.length} items < ${this.config.minBatchSize} minimum)`,
      };
    }

    // Check if batch is empty
    if (batchData.length === 0) {
      this.recordSkip(operationId, "batch-empty", 0);
      this.logSkipDecision(operationId, true, "batch-empty");
      return { skip: true, reason: "Batch is empty" };
    }

    // Check for duplicate processing
    const batchChecksum = this.calculateBatchChecksum(batchData);
    const lastChecksum = this.skipState.dataChecksums.get(operationId);

    if (lastChecksum === batchChecksum) {
      this.recordSkip(operationId, "batch-duplicate", 0);
      this.logSkipDecision(operationId, true, "batch-duplicate");
      return {
        skip: true,
        reason: "Batch data unchanged since last processing",
      };
    }

    // Update checksum for future comparisons
    this.skipState.dataChecksums.set(operationId, batchChecksum);

    this.logSkipDecision(operationId, false, "batch-valid");
    return {
      skip: false,
      reason: `Batch is valid (${batchData.length} items)`,
    };
  }

  /**
   * Check if incremental operation should be skipped
   */
  shouldSkipIncrementalOperation(
    operationId,
    currentData,
    previousData,
    threshold = null
  ) {
    this.metrics.totalChecks++;

    if (!previousData) {
      this.logSkipDecision(operationId, false, "no-previous-data");
      return { skip: false, reason: "No previous data for comparison" };
    }

    const changeThreshold = threshold || this.config.incrementalThreshold;
    const changeRatio = this.calculateChangeRatio(currentData, previousData);

    if (changeRatio < changeThreshold) {
      this.recordSkip(operationId, "incremental-minimal", 0);
      this.logSkipDecision(
        operationId,
        true,
        `incremental-minimal (${(changeRatio * 100).toFixed(1)}% change)`
      );
      return {
        skip: true,
        reason: `Minimal change detected (${(changeRatio * 100).toFixed(
          1
        )}% < ${(changeThreshold * 100).toFixed(1)}% threshold)`,
      };
    }

    this.logSkipDecision(
      operationId,
      false,
      `incremental-significant (${(changeRatio * 100).toFixed(1)}% change)`
    );
    return {
      skip: false,
      reason: `Significant change detected (${(changeRatio * 100).toFixed(
        1
      )}%)`,
    };
  }

  /**
   * Check if time-based operation should be skipped
   */
  shouldSkipTimeBasedOperation(operationId, intervalMs, forceRun = false) {
    this.metrics.totalChecks++;

    if (forceRun) {
      this.logSkipDecision(operationId, false, "force-run");
      return { skip: false, reason: "Force run requested" };
    }

    const lastProcessingTime =
      this.skipState.lastProcessingTimes.get(operationId);

    if (!lastProcessingTime) {
      this.skipState.lastProcessingTimes.set(operationId, Date.now());
      this.logSkipDecision(operationId, false, "first-run");
      return { skip: false, reason: "First time running operation" };
    }

    const timeSinceLastRun = Date.now() - lastProcessingTime;

    if (timeSinceLastRun < intervalMs) {
      this.recordSkip(operationId, "time-interval", timeSinceLastRun);
      this.logSkipDecision(
        operationId,
        true,
        `time-interval (${Math.round(timeSinceLastRun / 1000)}s < ${Math.round(
          intervalMs / 1000
        )}s)`
      );
      return {
        skip: true,
        reason: `Too soon since last run (${Math.round(
          timeSinceLastRun / 1000
        )}s < ${Math.round(intervalMs / 1000)}s interval)`,
      };
    }

    // Update last processing time
    this.skipState.lastProcessingTimes.set(operationId, Date.now());
    this.logSkipDecision(operationId, false, "time-interval-passed");
    return {
      skip: false,
      reason: `Interval passed (${Math.round(timeSinceLastRun / 1000)}s)`,
    };
  }

  /**
   * Check if dependency-based operation should be skipped
   */
  shouldSkipDependencyOperation(operationId, dependencies, dependencyStates) {
    this.metrics.totalChecks++;

    // Check if any dependencies are missing
    const missingDeps = dependencies.filter(
      (dep) => !dependencyStates.hasOwnProperty(dep)
    );
    if (missingDeps.length > 0) {
      this.recordSkip(operationId, "dependencies-missing", 0);
      this.logSkipDecision(
        operationId,
        true,
        `dependencies-missing (${missingDeps.join(", ")})`
      );
      return {
        skip: true,
        reason: `Missing dependencies: ${missingDeps.join(", ")}`,
      };
    }

    // Check if any dependencies have failed
    const failedDeps = dependencies.filter(
      (dep) => dependencyStates[dep] === "failed"
    );
    if (failedDeps.length > 0) {
      this.recordSkip(operationId, "dependencies-failed", 0);
      this.logSkipDecision(
        operationId,
        true,
        `dependencies-failed (${failedDeps.join(", ")})`
      );
      return {
        skip: true,
        reason: `Failed dependencies: ${failedDeps.join(", ")}`,
      };
    }

    // Check if dependencies haven't changed
    const currentDepState = this.calculateDependencyChecksum(
      dependencies,
      dependencyStates
    );
    const lastDepState = this.skipState.dependencyStates.get(operationId);

    if (lastDepState === currentDepState) {
      this.recordSkip(operationId, "dependencies-unchanged", 0);
      this.logSkipDecision(operationId, true, "dependencies-unchanged");
      return {
        skip: true,
        reason: "Dependencies unchanged since last processing",
      };
    }

    // Update dependency state
    this.skipState.dependencyStates.set(operationId, currentDepState);
    this.logSkipDecision(operationId, false, "dependencies-changed");
    return { skip: false, reason: "Dependencies have changed" };
  }

  /**
   * Check if resource-based operation should be skipped
   */
  shouldSkipResourceBasedOperation(operationId, resourceRequirements = {}) {
    this.metrics.totalChecks++;

    const currentMemory = process.memoryUsage().heapUsed;
    const requiredMemory = resourceRequirements.memory || 0;

    // Skip if insufficient memory
    if (
      requiredMemory > 0 &&
      currentMemory + requiredMemory > this.config.skipUnderMemoryUsage * 2
    ) {
      this.recordSkip(operationId, "insufficient-memory", 0);
      this.logSkipDecision(
        operationId,
        true,
        `insufficient-memory (${Math.round(
          currentMemory / 1024 / 1024
        )}MB + ${Math.round(requiredMemory / 1024 / 1024)}MB)`
      );
      return {
        skip: true,
        reason: `Insufficient memory (${Math.round(
          currentMemory / 1024 / 1024
        )}MB used, ${Math.round(requiredMemory / 1024 / 1024)}MB required)`,
      };
    }

    this.logSkipDecision(operationId, false, "resources-available");
    return { skip: false, reason: "Sufficient resources available" };
  }

  /**
   * Comprehensive skip check that combines multiple conditions
   */
  shouldSkipOperation(operationId, conditions = {}) {
    this.metrics.totalChecks++;

    const checks = [];

    // Cache-based check
    if (conditions.cache) {
      const cacheCheck = this.shouldSkipCachedOperation(
        operationId,
        conditions.cache.data,
        conditions.cache.ttl
      );
      if (cacheCheck.skip) return cacheCheck;
      checks.push("cache-stale");
    }

    // Batch-based check
    if (conditions.batch) {
      const batchCheck = this.shouldSkipBatchOperation(
        operationId,
        conditions.batch.data,
        conditions.batch.options
      );
      if (batchCheck.skip) return batchCheck;
      checks.push("batch-valid");
    }

    // Time-based check
    if (conditions.time) {
      const timeCheck = this.shouldSkipTimeBasedOperation(
        operationId,
        conditions.time.interval,
        conditions.time.force
      );
      if (timeCheck.skip) return timeCheck;
      checks.push("time-ready");
    }

    // Dependency-based check
    if (conditions.dependencies) {
      const depCheck = this.shouldSkipDependencyOperation(
        operationId,
        conditions.dependencies.required,
        conditions.dependencies.states
      );
      if (depCheck.skip) return depCheck;
      checks.push("dependencies-ready");
    }

    // Resource-based check
    if (conditions.resources) {
      const resourceCheck = this.shouldSkipResourceBasedOperation(
        operationId,
        conditions.resources.requirements
      );
      if (resourceCheck.skip) return resourceCheck;
      checks.push("resources-sufficient");
    }

    this.logSkipDecision(
      operationId,
      false,
      `all-checks-passed (${checks.join(", ")})`
    );
    return { skip: false, reason: `All conditions met (${checks.join(", ")})` };
  }

  /**
   * Calculate checksum for batch data
   */
  calculateBatchChecksum(batchData) {
    if (!Array.isArray(batchData)) return "not-array";

    // Simple checksum based on length and first/last items
    const length = batchData.length;
    const firstItem = batchData[0]
      ? JSON.stringify(batchData[0]).substring(0, 50)
      : "empty";
    const lastItem = batchData[length - 1]
      ? JSON.stringify(batchData[length - 1]).substring(0, 50)
      : "empty";

    return `${length}_${firstItem}_${lastItem}`;
  }

  /**
   * Calculate change ratio between datasets
   */
  calculateChangeRatio(currentData, previousData) {
    if (!previousData || !currentData) return 1.0; // 100% change if no comparison possible

    const currentSize = Array.isArray(currentData)
      ? currentData.length
      : Object.keys(currentData).length;
    const previousSize = Array.isArray(previousData)
      ? previousData.length
      : Object.keys(previousData).length;

    if (previousSize === 0) return currentSize > 0 ? 1.0 : 0.0;

    return Math.abs(currentSize - previousSize) / previousSize;
  }

  /**
   * Calculate dependency checksum
   */
  calculateDependencyChecksum(dependencies, states) {
    const depStates = dependencies
      .map((dep) => `${dep}:${states[dep] || "unknown"}`)
      .sort();
    return depStates.join("|");
  }

  /**
   * Record skip operation for metrics
   */
  recordSkip(operationId, reason, timeSaved = 0) {
    this.metrics.skippedOperations++;
    this.metrics.timeSaved += timeSaved;

    const currentCount = this.metrics.reasonCounts.get(reason) || 0;
    this.metrics.reasonCounts.set(reason, currentCount + 1);

    this.skipState.skipReasons.set(operationId, {
      reason,
      timestamp: Date.now(),
      timeSaved,
    });
  }

  /**
   * Log skip decision for debugging
   */
  logSkipDecision(operationId, skipped, reason) {
    if (!this.config.enableDetailedLogging) return;

    const action = skipped ? "⏭️ SKIP" : "▶️ RUN";
    const color = skipped ? chalk.yellow : chalk.green;

    console.log(color(`${action} ${operationId}: ${reason}`));
  }

  /**
   * Reset processing flags (useful for testing or manual resets)
   */
  resetProcessingFlags(operationIds = null) {
    if (operationIds) {
      if (Array.isArray(operationIds)) {
        operationIds.forEach((id) => {
          this.skipState.lastProcessingTimes.delete(id);
          this.skipState.dataChecksums.delete(id);
          this.skipState.dependencyStates.delete(id);
          this.skipState.processingFlags.delete(id);
          this.skipState.skipReasons.delete(id);
        });
        console.log(
          chalk.blue(
            `🔄 Reset skip state for ${operationIds.length} operations`
          )
        );
      } else {
        this.skipState.lastProcessingTimes.delete(operationIds);
        this.skipState.dataChecksums.delete(operationIds);
        this.skipState.dependencyStates.delete(operationIds);
        this.skipState.processingFlags.delete(operationIds);
        this.skipState.skipReasons.delete(operationIds);
        console.log(
          chalk.blue(`🔄 Reset skip state for operation: ${operationIds}`)
        );
      }
    } else {
      // Reset all
      this.skipState.lastProcessingTimes.clear();
      this.skipState.dataChecksums.clear();
      this.skipState.dependencyStates.clear();
      this.skipState.processingFlags.clear();
      this.skipState.skipReasons.clear();
      console.log(chalk.blue("🔄 Reset all skip state"));
    }
  }

  /**
   * Get skip logic metrics
   */
  getMetrics() {
    const totalTime = Date.now() - this.metrics.lastReset;
    const skipRate =
      this.metrics.totalChecks > 0
        ? (
            (this.metrics.skippedOperations / this.metrics.totalChecks) *
            100
          ).toFixed(1)
        : "0.0";

    return {
      totalChecks: this.metrics.totalChecks,
      skippedOperations: this.metrics.skippedOperations,
      skipRate: parseFloat(skipRate),
      timeSaved: this.metrics.timeSaved,
      avgTimeSavedPerSkip:
        this.metrics.skippedOperations > 0
          ? Math.round(this.metrics.timeSaved / this.metrics.skippedOperations)
          : 0,
      reasonBreakdown: Object.fromEntries(this.metrics.reasonCounts),
      totalTime,
      efficiency: (this.metrics.timeSaved / totalTime) * 100 || 0,
    };
  }

  /**
   * Generate skip logic report
   */
  generateSkipReport() {
    const metrics = this.getMetrics();

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalChecks: metrics.totalChecks,
        skippedOperations: metrics.skippedOperations,
        skipRate: `${metrics.skipRate}%`,
        timeSaved: `${Math.round(metrics.timeSaved / 1000)}s`,
        efficiency: `${metrics.efficiency.toFixed(1)}%`,
      },
      reasonBreakdown: metrics.reasonBreakdown,
      topSkipReasons: Array.from(this.metrics.reasonCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    };

    console.log(chalk.blue("📊 Skip Logic Report:"));
    console.log(JSON.stringify(report, null, 2));

    return report;
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalChecks: 0,
      skippedOperations: 0,
      reasonCounts: new Map(),
      timeSaved: 0,
      lastReset: Date.now(),
    };
    console.log(chalk.blue("📊 Skip logic metrics reset"));
  }

  /**
   * Shutdown skip logic manager
   */
  shutdown() {
    console.log(chalk.gray("📤 SkipLogicManager shutdown"));

    if (this.config.enableSkipMetrics) {
      const metrics = this.getMetrics();
      console.log(
        chalk.green(
          `✅ Skip logic saved ${Math.round(
            metrics.timeSaved / 1000
          )}s across ${metrics.skippedOperations} operations (${
            metrics.skipRate
          }% skip rate)`
        )
      );
    }

    // Clear all state
    this.skipState.lastProcessingTimes.clear();
    this.skipState.dataChecksums.clear();
    this.skipState.dependencyStates.clear();
    this.skipState.processingFlags.clear();
    this.skipState.skipReasons.clear();
  }
}

module.exports = SkipLogicManager;
