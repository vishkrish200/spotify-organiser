/**
 * Maintenance Command
 *
 * CLI command for managing data expiration, scheduled cleanup tasks,
 * and maintenance operations for the Spotify Organizer rollback system.
 */

const chalk = require("chalk");
const path = require("path");
const { Command } = require("commander");
const ExpirationScheduler = require("../lib/expirationScheduler");
const RollbackManager = require("../lib/rollbackManager");
const TableDisplay = require("../lib/tableDisplay");

class MaintenanceCommand {
  constructor() {
    this.scheduler = null;
    this.rollbackManager = null;
  }

  /**
   * Configure the maintenance command
   */
  configureCommand(program) {
    const maintenanceCmd = program
      .command("maintenance")
      .alias("maint")
      .description("Manage data expiration and automated maintenance");

    // Start scheduler
    maintenanceCmd
      .command("start")
      .description("Start the automated expiration scheduler")
      .option("--config <file>", "Custom configuration file")
      .option("--dry-run", "Run in dry-run mode (no actual deletions)")
      .option("--quiet", "Disable verbose logging")
      .action(async (options) => {
        await this.startScheduler(options);
      });

    // Stop scheduler
    maintenanceCmd
      .command("stop")
      .description("Stop the automated expiration scheduler")
      .action(async () => {
        await this.stopScheduler();
      });

    // Show scheduler status
    maintenanceCmd
      .command("status")
      .description("Show scheduler status and next run times")
      .action(async () => {
        await this.showStatus();
      });

    // Run maintenance immediately
    maintenanceCmd
      .command("run")
      .description("Run maintenance tasks immediately")
      .option(
        "--type <type>",
        "Maintenance type: full, quick, user-limits",
        "full"
      )
      .option("--dry-run", "Preview actions without making changes")
      .action(async (options) => {
        await this.runMaintenance(options);
      });

    // Show maintenance statistics
    maintenanceCmd
      .command("stats")
      .description("Show data expiration and storage statistics")
      .action(async () => {
        await this.showStats();
      });

    // Configure expiration policies
    maintenanceCmd
      .command("config")
      .description("View or update expiration configuration")
      .option(
        "--set <key=value>",
        "Set configuration value",
        this.collectKeyValue,
        {}
      )
      .option("--show", "Show current configuration")
      .action(async (options) => {
        await this.manageConfig(options);
      });

    return maintenanceCmd;
  }

  /**
   * Collect key=value pairs for configuration
   */
  collectKeyValue(value, previous) {
    const [key, val] = value.split("=");
    if (!key || val === undefined) {
      throw new Error("Configuration must be in format key=value");
    }

    // Parse value type
    let parsedValue = val;
    if (val === "true") parsedValue = true;
    else if (val === "false") parsedValue = false;
    else if (!isNaN(val)) parsedValue = parseFloat(val);

    previous[key] = parsedValue;
    return previous;
  }

  /**
   * Start the expiration scheduler
   */
  async startScheduler(options) {
    try {
      console.log(chalk.cyan("🚀 Starting expiration scheduler..."));

      // Load custom configuration if provided
      let customConfig = {};
      if (options.config) {
        try {
          customConfig = require(path.resolve(options.config));
          console.log(chalk.gray(`📁 Loaded config from: ${options.config}`));
        } catch (error) {
          console.warn(
            chalk.yellow(`⚠️  Failed to load config file: ${error.message}`)
          );
        }
      }

      // Apply CLI options
      if (options.dryRun) {
        customConfig.dryRunMode = true;
        console.log(chalk.yellow("🔍 Running in DRY-RUN mode"));
      }

      if (options.quiet) {
        customConfig.enableLogging = false;
      }

      // Initialize and start scheduler
      this.scheduler = new ExpirationScheduler();
      await this.scheduler.initialize(customConfig);
      await this.scheduler.start();

      console.log(chalk.green("✅ Expiration scheduler started successfully"));

      // Show initial status
      await this.showStatus();
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to start scheduler: ${error.message}`)
      );
      process.exit(1);
    }
  }

  /**
   * Stop the expiration scheduler
   */
  async stopScheduler() {
    try {
      if (!this.scheduler) {
        console.log(chalk.yellow("⚠️  No scheduler instance found"));
        return;
      }

      console.log(chalk.cyan("🛑 Stopping expiration scheduler..."));
      await this.scheduler.stop();
      await this.scheduler.cleanup();

      console.log(chalk.green("✅ Expiration scheduler stopped"));
    } catch (error) {
      console.error(chalk.red(`❌ Failed to stop scheduler: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Show scheduler status
   */
  async showStatus() {
    try {
      if (!this.scheduler) {
        this.scheduler = new ExpirationScheduler();
      }

      const status = this.scheduler.getStatus();

      console.log(chalk.cyan("\n📊 Expiration Scheduler Status"));
      console.log("─".repeat(50));

      console.log(
        `Initialized: ${
          status.isInitialized ? chalk.green("✅") : chalk.red("❌")
        }`
      );
      console.log(
        `Running: ${status.isRunning ? chalk.green("✅") : chalk.red("❌")}`
      );
      console.log(
        `Dry Run Mode: ${
          status.config.dryRunMode ? chalk.yellow("⚠️ ON") : chalk.green("OFF")
        }`
      );

      if (status.isRunning && status.scheduledJobs.length > 0) {
        console.log(chalk.cyan("\n⏰ Scheduled Jobs"));

        const jobsTable = new TableDisplay();
        jobsTable.setHeaders(["Job Name", "Next Run", "Relative"]);

        for (const job of status.scheduledJobs) {
          const nextRun = job.nextRun
            ? new Date(job.nextRun).toLocaleString()
            : "Not scheduled";
          const relative = job.nextRunRelative || "N/A";

          jobsTable.addRow([job.name, nextRun, relative]);
        }

        jobsTable.display();
      }

      // Show maintenance stats if scheduler is initialized
      if (status.isInitialized) {
        try {
          const stats = await this.scheduler.getMaintenanceStats();
          this.displayMaintenanceStats(stats);
        } catch (error) {
          console.warn(
            chalk.yellow(
              `⚠️  Could not fetch maintenance stats: ${error.message}`
            )
          );
        }
      }
    } catch (error) {
      console.error(chalk.red(`❌ Failed to show status: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Run maintenance immediately
   */
  async runMaintenance(options) {
    try {
      console.log(chalk.cyan(`🔧 Running ${options.type} maintenance...`));

      if (options.dryRun) {
        console.log(
          chalk.yellow("🔍 DRY-RUN mode: No actual changes will be made")
        );
      }

      // Initialize scheduler if needed
      if (!this.scheduler) {
        this.scheduler = new ExpirationScheduler();
        await this.scheduler.initialize({
          dryRunMode: options.dryRun,
          enableLogging: true,
        });
      }

      const startTime = Date.now();
      const result = await this.scheduler.runMaintenanceNow(options.type);
      const duration = Date.now() - startTime;

      console.log(
        chalk.green(`✅ ${options.type} maintenance completed in ${duration}ms`)
      );

      // Display results
      if (result && typeof result === "object") {
        console.log(chalk.cyan("\n📋 Maintenance Results"));
        console.log("─".repeat(30));

        if (result.sessionsMarkedExpired !== undefined) {
          console.log(
            `Sessions marked expired: ${result.sessionsMarkedExpired}`
          );
        }
        if (result.sessionsDeleted !== undefined) {
          console.log(`Sessions deleted: ${result.sessionsDeleted}`);
        }
        if (result.operationsCleaned !== undefined) {
          console.log(`Operations cleaned: ${result.operationsCleaned}`);
        }
        if (result.userLimitsEnforced !== undefined) {
          console.log(`User limits enforced: ${result.userLimitsEnforced}`);
        }

        if (result.errors && result.errors.length > 0) {
          console.log(
            chalk.yellow(`\n⚠️  Errors encountered: ${result.errors.length}`)
          );
          result.errors.forEach((error, index) => {
            console.log(chalk.yellow(`  ${index + 1}. ${error}`));
          });
        }
      }
    } catch (error) {
      console.error(chalk.red(`❌ Maintenance failed: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Show maintenance statistics
   */
  async showStats() {
    try {
      console.log(chalk.cyan("📊 Fetching maintenance statistics..."));

      // Initialize rollback manager
      this.rollbackManager = new RollbackManager();
      await this.rollbackManager.initialize();

      const stats = await this.rollbackManager.getExpirationStats();
      const rollbackStats = await this.rollbackManager.getStats();

      this.displayMaintenanceStats(stats);
      this.displayRollbackStats(rollbackStats);

      await this.rollbackManager.cleanup();
    } catch (error) {
      console.error(chalk.red(`❌ Failed to show stats: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Display maintenance statistics
   */
  displayMaintenanceStats(stats) {
    console.log(chalk.cyan("\n🔧 Maintenance Statistics"));
    console.log("─".repeat(40));

    console.log(
      `Sessions approaching expiry: ${chalk.yellow(
        stats.sessionsApproachingExpiry
      )}`
    );
    console.log(
      `Expired sessions ready for deletion: ${chalk.red(
        stats.expiredSessionsReadyForDeletion
      )}`
    );
    console.log(
      `Orphaned operations: ${chalk.yellow(stats.orphanedOperations)}`
    );
    console.log(`Total sessions: ${stats.totalSessions}`);
    console.log(`Total operations: ${stats.totalOperations}`);
    console.log(`Estimated storage: ${stats.estimatedStorageMB} MB`);

    if (stats.currentPolicy) {
      console.log(chalk.cyan("\n⚙️  Current Policy"));
      console.log(
        `Active session lifetime: ${stats.currentPolicy.activeSessionDays} days`
      );
      console.log(
        `Delete expired after: ${stats.currentPolicy.deleteExpiredAfterDays} days`
      );
      console.log(
        `Max sessions per user: ${stats.currentPolicy.maxSessionsPerUser}`
      );
      console.log(
        `Cleanup interval: ${stats.currentPolicy.cleanupIntervalHours} hours`
      );
    }
  }

  /**
   * Display rollback statistics
   */
  displayRollbackStats(stats) {
    console.log(chalk.cyan("\n🔄 Rollback Statistics"));
    console.log("─".repeat(30));

    console.log(`Active sessions: ${chalk.green(stats.activeSessions)}`);
    console.log(
      `Rolled back sessions: ${chalk.blue(stats.rolledBackSessions)}`
    );
    console.log(`Expired sessions: ${chalk.red(stats.expiredSessions)}`);
    console.log(`Total playlists created: ${stats.totalPlaylistsCreated}`);
    console.log(`Total tracks affected: ${stats.totalTracksAffected}`);
  }

  /**
   * Manage configuration
   */
  async manageConfig(options) {
    try {
      // Initialize scheduler if needed
      if (!this.scheduler) {
        this.scheduler = new ExpirationScheduler();
        await this.scheduler.initialize();
      }

      if (Object.keys(options.set).length > 0) {
        // Update configuration
        console.log(chalk.cyan("⚙️  Updating configuration..."));

        const newConfig = await this.scheduler.updateConfig(options.set);

        console.log(chalk.green("✅ Configuration updated"));
        for (const [key, value] of Object.entries(options.set)) {
          console.log(chalk.gray(`  ${key}: ${value}`));
        }
      }

      if (options.show || Object.keys(options.set).length === 0) {
        // Show current configuration
        const status = this.scheduler.getStatus();

        console.log(chalk.cyan("\n⚙️  Current Configuration"));
        console.log("─".repeat(40));

        const config = status.config;
        console.log(`Cleanup schedule: ${config.cleanupCron}`);
        console.log(`User limits schedule: ${config.userLimitsCron}`);
        console.log(
          `Quick maintenance schedule: ${config.quickMaintenanceCron}`
        );
        console.log(`Dry run mode: ${config.dryRunMode}`);
        console.log(`Max runtime: ${config.maxMaintenanceRuntime}ms`);
        console.log(`Enable user limits: ${config.enableUserLimits}`);
        console.log(`Enable cleanup expired: ${config.enableCleanupExpired}`);
        console.log(`Enable delete old: ${config.enableDeleteOldExpired}`);
        console.log(`Enable cleanup orphaned: ${config.enableCleanupOrphaned}`);
        console.log(`Enable logging: ${config.enableLogging}`);
      }
    } catch (error) {
      console.error(chalk.red(`❌ Failed to manage config: ${error.message}`));
      process.exit(1);
    }
  }
}

module.exports = MaintenanceCommand;
