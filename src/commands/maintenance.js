/**
 * Maintenance Command
 *
 * Provides data expiration management, cleanup operations, and policy
 * configuration for the rollback system. Handles automatic and manual
 * maintenance tasks including session expiration and data cleanup.
 */

const chalk = require("chalk");
const RollbackManager = require("../lib/rollbackManager");
const TableDisplay = require("../lib/tableDisplay");

class MaintenanceCommand {
  constructor() {
    this.rollbackManager = new RollbackManager();
    this.tableDisplay = new TableDisplay();
  }

  /**
   * Main maintenance command execution
   */
  async execute(options = {}) {
    const {
      cleanup = false,
      stats = false,
      policy = false,
      setPolicy = null,
      dryRun = false,
      force = false,
    } = options;

    try {
      console.log(chalk.cyan("🔧 Spotify Organizer Maintenance"));
      console.log("=".repeat(35));

      // Initialize rollback manager
      await this.rollbackManager.initialize();

      // Handle different maintenance operations
      if (policy || setPolicy) {
        return await this.handlePolicyOperations(setPolicy, dryRun);
      } else if (stats) {
        return await this.displayMaintenanceStats();
      } else if (cleanup) {
        return await this.performCleanup(dryRun, force);
      } else {
        // Default: show maintenance overview
        return await this.showMaintenanceOverview();
      }
    } catch (error) {
      console.error(chalk.red(`❌ Maintenance failed: ${error.message}`));
      throw error;
    } finally {
      await this.rollbackManager.cleanup();
    }
  }

  /**
   * Handle policy-related operations
   */
  async handlePolicyOperations(setPolicyOptions, dryRun) {
    if (setPolicyOptions) {
      console.log(chalk.cyan("📋 Setting Expiration Policy"));

      const newPolicy = await this.rollbackManager.setExpirationPolicy(
        setPolicyOptions
      );

      console.log(chalk.green("✅ Expiration policy updated"));
      console.log(this.formatPolicyDisplay(newPolicy));

      return { success: true, policy: newPolicy };
    } else {
      console.log(chalk.cyan("📋 Current Expiration Policy"));

      const currentPolicy = this.rollbackManager.getExpirationPolicy();
      console.log(this.formatPolicyDisplay(currentPolicy));

      return { success: true, policy: currentPolicy };
    }
  }

  /**
   * Display comprehensive maintenance statistics
   */
  async displayMaintenanceStats() {
    console.log(chalk.cyan("📊 Maintenance Statistics"));

    try {
      // Get general rollback stats
      const rollbackStats = await this.rollbackManager.getStats();

      // Get expiration-specific stats
      const expirationStats = await this.rollbackManager.getExpirationStats();

      // Display rollback statistics
      console.log(
        this.tableDisplay.createSectionHeader("Rollback System Overview")
      );

      const rollbackData = [
        { label: "Total Sessions", value: rollbackStats.totalSessions },
        { label: "Active Sessions", value: rollbackStats.activeSessions },
        {
          label: "Rolled Back Sessions",
          value: rollbackStats.rolledBackSessions,
        },
        { label: "Expired Sessions", value: rollbackStats.expiredSessions },
        {
          label: "Total Playlists Created",
          value: rollbackStats.totalPlaylistsCreated,
        },
        {
          label: "Total Tracks Affected",
          value: rollbackStats.totalTracksAffected,
        },
      ];

      console.log(this.tableDisplay.createSummaryTable(rollbackData));

      // Display expiration statistics
      console.log(
        this.tableDisplay.createSectionHeader("Data Expiration Status")
      );

      const expirationData = [
        {
          label: "Sessions Approaching Expiry",
          value: expirationStats.sessionsApproachingExpiry,
          details: "Next 7 days",
        },
        {
          label: "Expired Sessions (Ready for Deletion)",
          value: expirationStats.expiredSessionsReadyForDeletion,
          details: `After ${expirationStats.currentPolicy.deleteExpiredAfterDays} days`,
        },
        {
          label: "Orphaned Operations",
          value: expirationStats.orphanedOperations,
          details: "Need cleanup",
        },
        {
          label: "Storage Usage (Est.)",
          value: `${expirationStats.estimatedStorageMB} MB`,
          details: `${expirationStats.estimatedStorageKB} KB`,
        },
      ];

      console.log(this.tableDisplay.createSummaryTable(expirationData));

      // Display current policy
      console.log(
        this.tableDisplay.createSectionHeader("Current Expiration Policy")
      );
      console.log(this.formatPolicyDisplay(expirationStats.currentPolicy));

      return {
        success: true,
        rollbackStats,
        expirationStats,
        recommendedActions: this.getRecommendedActions(expirationStats),
      };
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to get maintenance stats: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Perform cleanup operations
   */
  async performCleanup(dryRun = false, force = false) {
    console.log(chalk.cyan(`🧹 Data Cleanup${dryRun ? " (DRY RUN)" : ""}`));

    try {
      if (!force && !dryRun) {
        console.log(
          chalk.yellow("⚠️  This will permanently delete expired data!")
        );
        console.log(
          chalk.gray("Use --dry-run to preview or --force to proceed")
        );
        return { success: false, reason: "confirmation_required" };
      }

      const maintenanceResult =
        await this.rollbackManager.performDataMaintenance({
          enforceUserLimits: true,
          cleanupExpired: true,
          deleteOldExpired: !dryRun, // Only delete if not dry run
          cleanupOrphaned: true,
          dryRun,
        });

      // Display results table
      console.log(this.tableDisplay.createSectionHeader("Cleanup Results"));

      const resultsData = [
        {
          label: "Sessions Marked Expired",
          value: maintenanceResult.sessionsMarkedExpired,
        },
        { label: "Sessions Deleted", value: maintenanceResult.sessionsDeleted },
        {
          label: "Operations Cleaned",
          value: maintenanceResult.operationsCleaned,
        },
        {
          label: "User Limits Enforced",
          value: maintenanceResult.userLimitsEnforced,
        },
        { label: "Errors Encountered", value: maintenanceResult.errors.length },
      ];

      console.log(this.tableDisplay.createSummaryTable(resultsData));

      if (maintenanceResult.errors.length > 0) {
        console.log(chalk.red("\n❌ Errors Encountered:"));
        maintenanceResult.errors.forEach((error, index) => {
          console.log(chalk.red(`   ${index + 1}. ${error}`));
        });
      }

      return { success: true, maintenanceResult };
    } catch (error) {
      console.error(chalk.red(`❌ Cleanup failed: ${error.message}`));
      throw error;
    }
  }

  /**
   * Show maintenance overview
   */
  async showMaintenanceOverview() {
    console.log(chalk.cyan("📋 Maintenance Overview"));

    try {
      const stats = await this.rollbackManager.getExpirationStats();
      const recommendedActions = this.getRecommendedActions(stats);

      // Show current status
      console.log(this.tableDisplay.createSectionHeader("System Status"));

      const statusData = [
        {
          label: "Active Sessions",
          value: stats.totalSessions - stats.expiredSessionsReadyForDeletion,
        },
        {
          label: "Sessions Needing Attention",
          value:
            stats.sessionsApproachingExpiry +
            stats.expiredSessionsReadyForDeletion,
        },
        { label: "Storage Usage", value: `${stats.estimatedStorageMB} MB` },
        { label: "Orphaned Operations", value: stats.orphanedOperations },
      ];

      console.log(this.tableDisplay.createSummaryTable(statusData));

      // Show recommended actions
      if (recommendedActions.length > 0) {
        console.log(
          this.tableDisplay.createSectionHeader("Recommended Actions")
        );
        recommendedActions.forEach((action, index) => {
          console.log(chalk.yellow(`   ${index + 1}. ${action}`));
        });
      } else {
        console.log(
          chalk.green("\n✅ No maintenance actions required at this time")
        );
      }

      // Show available commands
      console.log(this.tableDisplay.createSectionHeader("Available Commands"));
      console.log(
        chalk.white(
          "   spotify-organizer maintenance --stats    # View detailed statistics"
        )
      );
      console.log(
        chalk.white(
          "   spotify-organizer maintenance --cleanup   # Preview cleanup operations"
        )
      );
      console.log(
        chalk.white(
          "   spotify-organizer maintenance --cleanup --force # Perform cleanup"
        )
      );
      console.log(
        chalk.white(
          "   spotify-organizer maintenance --policy    # View expiration policy"
        )
      );

      return { success: true, stats, recommendedActions };
    } catch (error) {
      console.error(chalk.red(`❌ Failed to show overview: ${error.message}`));
      throw error;
    }
  }

  /**
   * Format policy display
   */
  formatPolicyDisplay(policy) {
    const policyData = [
      {
        label: "Active Session Lifetime",
        value: `${policy.activeSessionDays} days`,
      },
      {
        label: "Delete Expired After",
        value: `${policy.deleteExpiredAfterDays} days`,
      },
      { label: "Max Sessions Per User", value: policy.maxSessionsPerUser },
      {
        label: "Cleanup Interval",
        value: `${policy.cleanupIntervalHours} hours`,
      },
      { label: "Batch Size", value: policy.batchSize },
    ];

    return this.tableDisplay.createSummaryTable(policyData);
  }

  /**
   * Get recommended maintenance actions
   */
  getRecommendedActions(stats) {
    const actions = [];

    if (stats.expiredSessionsReadyForDeletion > 10) {
      actions.push(
        `Clean up ${stats.expiredSessionsReadyForDeletion} expired sessions to free storage`
      );
    }

    if (stats.orphanedOperations > 0) {
      actions.push(`Clean up ${stats.orphanedOperations} orphaned operations`);
    }

    if (stats.sessionsApproachingExpiry > 20) {
      actions.push(
        `${stats.sessionsApproachingExpiry} sessions will expire soon - consider reviewing retention policy`
      );
    }

    if (stats.estimatedStorageMB > 100) {
      actions.push(
        `Storage usage is ${stats.estimatedStorageMB} MB - consider reducing retention periods`
      );
    }

    return actions;
  }
}

/**
 * Command handler function for CLI
 */
async function maintenanceCommand(options = {}) {
  const maintenance = new MaintenanceCommand();
  return await maintenance.execute(options);
}

module.exports = {
  MaintenanceCommand,
  maintenanceCommand,
};
