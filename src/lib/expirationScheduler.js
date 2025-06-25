/**
 * Expiration Scheduler
 *
 * Handles automated scheduling of data expiration and cleanup tasks
 * for the Spotify Organizer rollback system. Uses node-schedule to
 * run maintenance operations at configured intervals.
 */

const schedule = require("node-schedule");
const chalk = require("chalk");
const RollbackManager = require("./rollbackManager");

class ExpirationScheduler {
  constructor() {
    this.rollbackManager = null;
    this.scheduledJobs = new Map();
    this.isInitialized = false;
    this.isRunning = false;

    // Default configuration
    this.config = {
      // Run cleanup every 24 hours at 2 AM
      cleanupCron: "0 2 * * *",
      // Run user limit enforcement every 12 hours
      userLimitsCron: "0 */12 * * *",
      // Quick maintenance every 6 hours
      quickMaintenanceCron: "0 */6 * * *",

      // Maintenance options
      enableUserLimits: true,
      enableCleanupExpired: true,
      enableDeleteOldExpired: true,
      enableCleanupOrphaned: true,

      // Safety options
      dryRunMode: false,
      maxMaintenanceRuntime: 30 * 60 * 1000, // 30 minutes max
      enableLogging: true,
    };
  }

  /**
   * Initialize the expiration scheduler
   */
  async initialize(customConfig = {}) {
    if (this.isInitialized) return;

    try {
      // Merge custom configuration
      this.config = { ...this.config, ...customConfig };

      // Initialize rollback manager
      this.rollbackManager = new RollbackManager();
      await this.rollbackManager.initialize();

      this.isInitialized = true;

      if (this.config.enableLogging) {
        console.log(chalk.gray("⏰ ExpirationScheduler initialized"));
        console.log(
          chalk.gray("   Cleanup schedule: " + this.config.cleanupCron)
        );
        console.log(
          chalk.gray("   User limits schedule: " + this.config.userLimitsCron)
        );
        console.log(
          chalk.gray(
            "   Quick maintenance schedule: " + this.config.quickMaintenanceCron
          )
        );
      }
    } catch (error) {
      console.error(
        chalk.red(
          "❌ Failed to initialize ExpirationScheduler: " + error.message
        )
      );
      throw error;
    }
  }

  /**
   * Start all scheduled tasks
   */
  async start() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      console.log(chalk.yellow("⚠️  Scheduler is already running"));
      return;
    }

    try {
      // Schedule full cleanup maintenance
      const cleanupJob = schedule.scheduleJob(
        "cleanup-maintenance",
        this.config.cleanupCron,
        async () => {
          await this.runFullMaintenance();
        }
      );

      // Schedule user limits enforcement
      const userLimitsJob = schedule.scheduleJob(
        "user-limits-enforcement",
        this.config.userLimitsCron,
        async () => {
          await this.runUserLimitsEnforcement();
        }
      );

      // Schedule quick maintenance
      const quickMaintenanceJob = schedule.scheduleJob(
        "quick-maintenance",
        this.config.quickMaintenanceCron,
        async () => {
          await this.runQuickMaintenance();
        }
      );

      // Store job references
      this.scheduledJobs.set("cleanup-maintenance", cleanupJob);
      this.scheduledJobs.set("user-limits-enforcement", userLimitsJob);
      this.scheduledJobs.set("quick-maintenance", quickMaintenanceJob);

      this.isRunning = true;

      if (this.config.enableLogging) {
        console.log(chalk.green("✅ Expiration scheduler started"));
        console.log(chalk.gray("   Active jobs: " + this.scheduledJobs.size));

        // Log next run times
        for (const [name, job] of this.scheduledJobs) {
          const nextRun = job.nextInvocation();
          if (nextRun) {
            console.log(
              chalk.gray("   Next " + name + ": " + nextRun.toLocaleString())
            );
          }
        }
      }

      // Run initial quick maintenance to clean up any immediate issues
      setTimeout(() => {
        this.runQuickMaintenance();
      }, 5000); // Wait 5 seconds after startup
    } catch (error) {
      console.error(
        chalk.red("❌ Failed to start scheduler: " + error.message)
      );
      throw error;
    }
  }

  /**
   * Stop all scheduled tasks
   */
  async stop() {
    if (!this.isRunning) {
      console.log(chalk.yellow("⚠️  Scheduler is not running"));
      return;
    }

    try {
      // Cancel all scheduled jobs
      for (const [name, job] of this.scheduledJobs) {
        const cancelled = job.cancel();
        if (this.config.enableLogging) {
          console.log(
            chalk.gray("🛑 Cancelled job: " + name + " (" + cancelled + ")")
          );
        }
      }

      this.scheduledJobs.clear();
      this.isRunning = false;

      if (this.config.enableLogging) {
        console.log(chalk.green("✅ Expiration scheduler stopped"));
      }
    } catch (error) {
      console.error(chalk.red("❌ Failed to stop scheduler: " + error.message));
      throw error;
    }
  }

  /**
   * Run full maintenance with all cleanup operations
   */
  async runFullMaintenance() {
    const startTime = Date.now();
    const maintenanceId = "full-" + Date.now();

    if (this.config.enableLogging) {
      console.log(
        chalk.cyan("🔧 Starting full maintenance [" + maintenanceId + "]")
      );
    }

    try {
      // Create timeout to prevent runaway maintenance
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              "Maintenance timeout after " +
                this.config.maxMaintenanceRuntime +
                "ms"
            )
          );
        }, this.config.maxMaintenanceRuntime);
      });

      // Run maintenance with timeout protection
      const maintenancePromise = this.rollbackManager.performDataMaintenance({
        enforceUserLimits: this.config.enableUserLimits,
        cleanupExpired: this.config.enableCleanupExpired,
        deleteOldExpired: this.config.enableDeleteOldExpired,
        cleanupOrphaned: this.config.enableCleanupOrphaned,
        dryRun: this.config.dryRunMode,
      });

      const result = await Promise.race([maintenancePromise, timeoutPromise]);
      const duration = Date.now() - startTime;

      if (this.config.enableLogging) {
        console.log(
          chalk.green(
            "✅ Full maintenance completed [" +
              maintenanceId +
              "] in " +
              duration +
              "ms"
          )
        );

        if (result.errors && result.errors.length > 0) {
          console.log(
            chalk.yellow(
              "⚠️  Maintenance completed with " +
                result.errors.length +
                " errors"
            )
          );
        }
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        chalk.red(
          "❌ Full maintenance failed [" +
            maintenanceId +
            "] after " +
            duration +
            "ms: " +
            error.message
        )
      );
      return { error: error.message, duration };
    }
  }

  /**
   * Run user limits enforcement only
   */
  async runUserLimitsEnforcement() {
    const startTime = Date.now();

    if (this.config.enableLogging) {
      console.log(chalk.cyan("⚖️  Running user limits enforcement"));
    }

    try {
      const result = await this.rollbackManager.performDataMaintenance({
        enforceUserLimits: true,
        cleanupExpired: false,
        deleteOldExpired: false,
        cleanupOrphaned: false,
        dryRun: this.config.dryRunMode,
      });

      const duration = Date.now() - startTime;

      if (this.config.enableLogging) {
        console.log(
          chalk.green(
            "✅ User limits enforcement completed in " + duration + "ms"
          )
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        chalk.red(
          "❌ User limits enforcement failed after " +
            duration +
            "ms: " +
            error.message
        )
      );
      return { error: error.message, duration };
    }
  }

  /**
   * Run quick maintenance (mark expired sessions only)
   */
  async runQuickMaintenance() {
    const startTime = Date.now();

    if (this.config.enableLogging) {
      console.log(chalk.cyan("⚡ Running quick maintenance"));
    }

    try {
      const result = await this.rollbackManager.performDataMaintenance({
        enforceUserLimits: false,
        cleanupExpired: true, // Mark expired sessions
        deleteOldExpired: false, // Don't delete yet
        cleanupOrphaned: true, // Clean orphaned operations
        dryRun: this.config.dryRunMode,
      });

      const duration = Date.now() - startTime;

      if (this.config.enableLogging) {
        console.log(
          chalk.green("✅ Quick maintenance completed in " + duration + "ms")
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        chalk.red(
          "❌ Quick maintenance failed after " +
            duration +
            "ms: " +
            error.message
        )
      );
      return { error: error.message, duration };
    }
  }

  /**
   * Run maintenance immediately (manual trigger)
   */
  async runMaintenanceNow(type = "full") {
    if (!this.isInitialized) {
      await this.initialize();
    }

    switch (type) {
      case "full":
        return await this.runFullMaintenance();
      case "quick":
        return await this.runQuickMaintenance();
      case "user-limits":
        return await this.runUserLimitsEnforcement();
      default:
        throw new Error("Unknown maintenance type: " + type);
    }
  }

  /**
   * Get scheduler status and next run times
   */
  getStatus() {
    const status = {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      config: this.config,
      scheduledJobs: [],
    };

    if (this.isRunning) {
      for (const [name, job] of this.scheduledJobs) {
        const nextRun = job.nextInvocation();
        status.scheduledJobs.push({
          name,
          nextRun: nextRun ? nextRun.toISOString() : null,
          nextRunRelative: nextRun ? this.getRelativeTime(nextRun) : null,
        });
      }
    }

    return status;
  }

  /**
   * Update scheduler configuration
   */
  async updateConfig(newConfig) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    // If running and cron schedules changed, restart scheduler
    const cronFields = [
      "cleanupCron",
      "userLimitsCron",
      "quickMaintenanceCron",
    ];
    const cronChanged = cronFields.some(
      (field) => newConfig[field] && newConfig[field] !== oldConfig[field]
    );

    if (this.isRunning && cronChanged) {
      if (this.config.enableLogging) {
        console.log(
          chalk.yellow("🔄 Restarting scheduler due to configuration changes")
        );
      }
      await this.stop();
      await this.start();
    }

    return this.config;
  }

  /**
   * Get human-readable relative time
   */
  getRelativeTime(date) {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    if (diffMs < 0) return "overdue";

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours > 0) {
      return "in " + diffHours + "h " + diffMinutes + "m";
    } else {
      return "in " + diffMinutes + "m";
    }
  }

  /**
   * Get maintenance statistics
   */
  async getMaintenanceStats() {
    if (!this.isInitialized) {
      throw new Error("Scheduler not initialized");
    }

    return await this.rollbackManager.getExpirationStats();
  }

  /**
   * Cleanup and stop all scheduled tasks
   */
  async cleanup() {
    try {
      await this.stop();

      if (this.rollbackManager) {
        await this.rollbackManager.cleanup();
      }

      this.isInitialized = false;

      if (this.config.enableLogging) {
        console.log(chalk.gray("🔄 ExpirationScheduler cleaned up"));
      }
    } catch (error) {
      console.error(
        chalk.red("❌ Error cleaning up ExpirationScheduler: " + error.message)
      );
    }
  }
}

module.exports = ExpirationScheduler;
