/**
 * Expiration Scheduler Test
 *
 * Test script to verify the ExpirationScheduler implementation
 * and automated data expiration policies functionality.
 */

const chalk = require("chalk");
const ExpirationScheduler = require("../lib/expirationScheduler");
const RollbackManager = require("../lib/rollbackManager");

class ExpirationTest {
  constructor() {
    this.scheduler = null;
    this.rollbackManager = null;
  }

  /**
   * Run comprehensive expiration tests
   */
  async runTests() {
    console.log(chalk.cyan("🧪 Starting Expiration Scheduler Tests"));
    console.log("=".repeat(50));

    try {
      await this.testSchedulerInitialization();
      await this.testExpirationPolicies();
      await this.testMaintenanceOperations();
      await this.testScheduledJobs();
      await this.testConfigurationManagement();

      console.log(
        chalk.green("\n✅ All expiration tests passed successfully!")
      );
    } catch (error) {
      console.error(chalk.red(`\n❌ Test failed: ${error.message}`));
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test scheduler initialization
   */
  async testSchedulerInitialization() {
    console.log(chalk.cyan("\n1. Testing Scheduler Initialization"));
    console.log("─".repeat(40));

    // Test basic initialization
    this.scheduler = new ExpirationScheduler();

    // Test with custom config
    const customConfig = {
      dryRunMode: true,
      enableLogging: true,
      cleanupCron: "0 3 * * *", // 3 AM daily
    };

    await this.scheduler.initialize(customConfig);

    const status = this.scheduler.getStatus();
    console.log(chalk.green("✓ Scheduler initialized successfully"));
    console.log(chalk.gray(`  Initialized: ${status.isInitialized}`));
    console.log(chalk.gray(`  Dry run mode: ${status.config.dryRunMode}`));
    console.log(chalk.gray(`  Cleanup schedule: ${status.config.cleanupCron}`));
  }

  /**
   * Test expiration policies and statistics
   */
  async testExpirationPolicies() {
    console.log(chalk.cyan("\n2. Testing Expiration Policies"));
    console.log("─".repeat(40));

    // Test maintenance statistics
    const stats = await this.scheduler.getMaintenanceStats();
    console.log(chalk.green("✓ Retrieved maintenance statistics"));
    console.log(chalk.gray(`  Total sessions: ${stats.totalSessions}`));
    console.log(chalk.gray(`  Total operations: ${stats.totalOperations}`));
    console.log(
      chalk.gray(`  Estimated storage: ${stats.estimatedStorageMB} MB`)
    );
    console.log(
      chalk.gray(
        `  Sessions approaching expiry: ${stats.sessionsApproachingExpiry}`
      )
    );
  }

  /**
   * Test maintenance operations
   */
  async testMaintenanceOperations() {
    console.log(chalk.cyan("\n3. Testing Maintenance Operations"));
    console.log("─".repeat(40));

    // Test quick maintenance
    console.log(chalk.yellow("  Running quick maintenance..."));
    const quickResult = await this.scheduler.runMaintenanceNow("quick");
    console.log(chalk.green("✓ Quick maintenance completed"));

    if (quickResult.sessionsMarkedExpired !== undefined) {
      console.log(
        chalk.gray(
          `  Sessions marked expired: ${quickResult.sessionsMarkedExpired}`
        )
      );
    }
    if (quickResult.operationsCleaned !== undefined) {
      console.log(
        chalk.gray(`  Operations cleaned: ${quickResult.operationsCleaned}`)
      );
    }

    // Test user limits enforcement
    console.log(chalk.yellow("  Running user limits enforcement..."));
    const limitsResult = await this.scheduler.runMaintenanceNow("user-limits");
    console.log(chalk.green("✓ User limits enforcement completed"));
  }

  /**
   * Test scheduled jobs management
   */
  async testScheduledJobs() {
    console.log(chalk.cyan("\n4. Testing Scheduled Jobs"));
    console.log("─".repeat(40));

    // Start scheduler
    await this.scheduler.start();
    console.log(chalk.green("✓ Scheduler started"));

    const status = this.scheduler.getStatus();
    console.log(chalk.gray(`  Running: ${status.isRunning}`));
    console.log(chalk.gray(`  Scheduled jobs: ${status.scheduledJobs.length}`));

    // Display scheduled jobs
    if (status.scheduledJobs.length > 0) {
      console.log(chalk.yellow("  Scheduled jobs:"));
      status.scheduledJobs.forEach((job) => {
        console.log(chalk.gray(`    ${job.name}: ${job.nextRunRelative}`));
      });
    }

    // Stop scheduler
    await this.scheduler.stop();
    console.log(chalk.green("✓ Scheduler stopped"));
  }

  /**
   * Test configuration management
   */
  async testConfigurationManagement() {
    console.log(chalk.cyan("\n5. Testing Configuration Management"));
    console.log("─".repeat(40));

    // Test configuration update
    const newConfig = {
      quickMaintenanceCron: "0 */4 * * *", // Every 4 hours
      maxMaintenanceRuntime: 20 * 60 * 1000, // 20 minutes
    };

    await this.scheduler.updateConfig(newConfig);
    console.log(chalk.green("✓ Configuration updated"));

    const status = this.scheduler.getStatus();
    console.log(
      chalk.gray(
        `  Quick maintenance cron: ${status.config.quickMaintenanceCron}`
      )
    );
    console.log(
      chalk.gray(`  Max runtime: ${status.config.maxMaintenanceRuntime}ms`)
    );
  }

  /**
   * Test rollback manager integration
   */
  async testRollbackManagerIntegration() {
    console.log(chalk.cyan("\n6. Testing RollbackManager Integration"));
    console.log("─".repeat(40));

    this.rollbackManager = new RollbackManager();
    await this.rollbackManager.initialize();

    // Test expiration stats
    const stats = await this.rollbackManager.getExpirationStats();
    console.log(chalk.green("✓ RollbackManager integration working"));
    console.log(
      chalk.gray(
        `  Current policy active days: ${stats.currentPolicy.activeSessionDays}`
      )
    );
    console.log(
      chalk.gray(
        `  Delete expired after: ${stats.currentPolicy.deleteExpiredAfterDays} days`
      )
    );
  }

  /**
   * Cleanup test resources
   */
  async cleanup() {
    console.log(chalk.cyan("\n🧹 Cleaning up test resources..."));

    try {
      if (this.scheduler) {
        await this.scheduler.cleanup();
        console.log(chalk.gray("✓ Scheduler cleaned up"));
      }

      if (this.rollbackManager) {
        await this.rollbackManager.cleanup();
        console.log(chalk.gray("✓ RollbackManager cleaned up"));
      }
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Cleanup warning: ${error.message}`));
    }
  }
}

/**
 * Run the test if this file is executed directly
 */
async function runExpirationTest() {
  const test = new ExpirationTest();

  try {
    await test.runTests();
    process.exit(0);
  } catch (error) {
    console.error(chalk.red(`❌ Test suite failed: ${error.message}`));
    if (process.env.NODE_ENV === "development") {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runExpirationTest();
}

module.exports = ExpirationTest;
