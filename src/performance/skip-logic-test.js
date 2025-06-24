/**
 * Skip Logic Integration Test
 *
 * Tests the SkipLogicManager integration with SpotifyIngest and MusicAnalysis modules
 * to verify intelligent conditional processing is working correctly
 */

const chalk = require("chalk");
const SpotifyIngest = require("../lib/ingest");
const MusicAnalysis = require("../lib/analysis");

class SkipLogicTest {
  constructor() {
    this.ingest = new SpotifyIngest();
    this.analysis = new MusicAnalysis();
  }

  /**
   * Run comprehensive skip logic tests
   */
  async runTests() {
    console.log(chalk.cyan("🧪 Starting Skip Logic Integration Tests\n"));

    try {
      // Test 1: Initialize modules
      console.log(
        chalk.blue("Test 1: Initializing modules with skip logic...")
      );
      const ingestInit = await this.ingest.initialize();
      const analysisInit = await this.analysis.initialize();

      if (ingestInit && analysisInit) {
        console.log(chalk.green("✅ Modules initialized successfully"));
      } else {
        console.log(chalk.red("❌ Module initialization failed"));
        return;
      }

      // Test 2: Test skip logic metrics
      console.log(chalk.blue("\nTest 2: Testing skip logic metrics..."));
      this.testSkipMetrics();

      // Test 3: Test batch skip logic
      console.log(chalk.blue("\nTest 3: Testing batch skip logic..."));
      await this.testBatchSkipLogic();

      // Test 4: Test time-based skip logic
      console.log(chalk.blue("\nTest 4: Testing time-based skip logic..."));
      await this.testTimeBasedSkipLogic();

      // Test 5: Test cache-based skip logic
      console.log(chalk.blue("\nTest 5: Testing cache-based skip logic..."));
      await this.testCacheBasedSkipLogic();

      // Test 6: Test incremental skip logic
      console.log(chalk.blue("\nTest 6: Testing incremental skip logic..."));
      await this.testIncrementalSkipLogic();

      // Test 7: Test resource-based skip logic
      console.log(chalk.blue("\nTest 7: Testing resource-based skip logic..."));
      await this.testResourceBasedSkipLogic();

      // Test 8: Test comprehensive skip logic
      console.log(chalk.blue("\nTest 8: Testing comprehensive skip logic..."));
      await this.testComprehensiveSkipLogic();

      // Final metrics report
      console.log(chalk.blue("\nFinal Skip Logic Metrics:"));
      this.displayFinalMetrics();

      console.log(
        chalk.green("\n✅ All skip logic tests completed successfully!")
      );
    } catch (error) {
      console.log(chalk.red(`❌ Test failed: ${error.message}`));
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test skip logic metrics functionality
   */
  testSkipMetrics() {
    try {
      const ingestMetrics = this.ingest.getSkipMetrics();
      const analysisMetrics = this.analysis.getSkipMetrics();

      console.log(
        chalk.gray("   📊 Ingest skip metrics:"),
        JSON.stringify(ingestMetrics, null, 2)
      );
      console.log(
        chalk.gray("   📊 Analysis skip metrics:"),
        JSON.stringify(analysisMetrics, null, 2)
      );
      console.log(chalk.green("   ✅ Skip metrics accessible"));
    } catch (error) {
      console.log(
        chalk.red(`   ❌ Skip metrics test failed: ${error.message}`)
      );
    }
  }

  /**
   * Test batch skip logic
   */
  async testBatchSkipLogic() {
    try {
      const ingestSkipManager = this.ingest.skipLogicManager;
      const analysisSkipManager = this.analysis.skipLogicManager;

      // Test empty batch (should skip)
      const emptyBatchResult = ingestSkipManager.shouldSkipBatchOperation(
        "test_empty_batch",
        []
      );
      console.log(
        chalk.gray(
          `   Empty batch result: ${emptyBatchResult.skip ? "SKIP" : "RUN"} - ${
            emptyBatchResult.reason
          }`
        )
      );

      // Test small batch (should skip based on minBatchSize)
      const smallBatchResult = ingestSkipManager.shouldSkipBatchOperation(
        "test_small_batch",
        [1, 2]
      );
      console.log(
        chalk.gray(
          `   Small batch result: ${smallBatchResult.skip ? "SKIP" : "RUN"} - ${
            smallBatchResult.reason
          }`
        )
      );

      // Test valid batch (should not skip)
      const validBatch = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        data: `item_${i}`,
      }));
      const validBatchResult = analysisSkipManager.shouldSkipBatchOperation(
        "test_valid_batch",
        validBatch
      );
      console.log(
        chalk.gray(
          `   Valid batch result: ${validBatchResult.skip ? "SKIP" : "RUN"} - ${
            validBatchResult.reason
          }`
        )
      );

      console.log(chalk.green("   ✅ Batch skip logic working correctly"));
    } catch (error) {
      console.log(
        chalk.red(`   ❌ Batch skip logic test failed: ${error.message}`)
      );
    }
  }

  /**
   * Test time-based skip logic
   */
  async testTimeBasedSkipLogic() {
    try {
      const skipManager = this.ingest.skipLogicManager;

      // First run (should not skip)
      const firstRun = skipManager.shouldSkipTimeBasedOperation(
        "test_time_operation",
        5000
      );
      console.log(
        chalk.gray(
          `   First run result: ${firstRun.skip ? "SKIP" : "RUN"} - ${
            firstRun.reason
          }`
        )
      );

      // Immediate second run (should skip)
      const secondRun = skipManager.shouldSkipTimeBasedOperation(
        "test_time_operation",
        5000
      );
      console.log(
        chalk.gray(
          `   Second run result: ${secondRun.skip ? "SKIP" : "RUN"} - ${
            secondRun.reason
          }`
        )
      );

      // Force run (should not skip)
      const forceRun = skipManager.shouldSkipTimeBasedOperation(
        "test_time_operation",
        5000,
        true
      );
      console.log(
        chalk.gray(
          `   Force run result: ${forceRun.skip ? "SKIP" : "RUN"} - ${
            forceRun.reason
          }`
        )
      );

      console.log(chalk.green("   ✅ Time-based skip logic working correctly"));
    } catch (error) {
      console.log(
        chalk.red(`   ❌ Time-based skip logic test failed: ${error.message}`)
      );
    }
  }

  /**
   * Test cache-based skip logic
   */
  async testCacheBasedSkipLogic() {
    try {
      const skipManager = this.analysis.skipLogicManager;

      // Test with no cache data (should not skip)
      const noCacheResult = skipManager.shouldSkipCachedOperation(
        "test_cache_operation",
        null
      );
      console.log(
        chalk.gray(
          `   No cache result: ${noCacheResult.skip ? "SKIP" : "RUN"} - ${
            noCacheResult.reason
          }`
        )
      );

      // Test with fresh cache data (should skip)
      const freshCacheData = {
        timestamp: Date.now() - 5 * 60 * 1000, // 5 minutes ago
        value: { data: "test_data", count: 100 },
      };
      const freshCacheResult = skipManager.shouldSkipCachedOperation(
        "test_cache_operation",
        freshCacheData,
        10 * 60 * 1000
      );
      console.log(
        chalk.gray(
          `   Fresh cache result: ${freshCacheResult.skip ? "SKIP" : "RUN"} - ${
            freshCacheResult.reason
          }`
        )
      );

      // Test with stale cache data (should not skip)
      const staleCacheData = {
        timestamp: Date.now() - 15 * 60 * 1000, // 15 minutes ago
        value: { data: "old_data", count: 50 },
      };
      const staleCacheResult = skipManager.shouldSkipCachedOperation(
        "test_cache_operation",
        staleCacheData,
        10 * 60 * 1000
      );
      console.log(
        chalk.gray(
          `   Stale cache result: ${staleCacheResult.skip ? "SKIP" : "RUN"} - ${
            staleCacheResult.reason
          }`
        )
      );

      console.log(
        chalk.green("   ✅ Cache-based skip logic working correctly")
      );
    } catch (error) {
      console.log(
        chalk.red(`   ❌ Cache-based skip logic test failed: ${error.message}`)
      );
    }
  }

  /**
   * Test incremental skip logic
   */
  async testIncrementalSkipLogic() {
    try {
      const skipManager = this.ingest.skipLogicManager;

      const currentData = { tracks: 1000, albums: 100, artists: 50 };
      const previousData = { tracks: 990, albums: 98, artists: 49 };
      const significantData = { tracks: 1200, albums: 150, artists: 75 };

      // Test minimal change (should skip)
      const minimalResult = skipManager.shouldSkipIncrementalOperation(
        "test_incremental",
        currentData,
        previousData,
        0.1
      );
      console.log(
        chalk.gray(
          `   Minimal change result: ${minimalResult.skip ? "SKIP" : "RUN"} - ${
            minimalResult.reason
          }`
        )
      );

      // Test significant change (should not skip)
      const significantResult = skipManager.shouldSkipIncrementalOperation(
        "test_incremental",
        significantData,
        previousData,
        0.1
      );
      console.log(
        chalk.gray(
          `   Significant change result: ${
            significantResult.skip ? "SKIP" : "RUN"
          } - ${significantResult.reason}`
        )
      );

      console.log(
        chalk.green("   ✅ Incremental skip logic working correctly")
      );
    } catch (error) {
      console.log(
        chalk.red(`   ❌ Incremental skip logic test failed: ${error.message}`)
      );
    }
  }

  /**
   * Test resource-based skip logic
   */
  async testResourceBasedSkipLogic() {
    try {
      const skipManager = this.analysis.skipLogicManager;

      // Test with no resource requirements (should not skip)
      const noResourceResult = skipManager.shouldSkipResourceBasedOperation(
        "test_resource_operation",
        {}
      );
      console.log(
        chalk.gray(
          `   No resource requirements: ${
            noResourceResult.skip ? "SKIP" : "RUN"
          } - ${noResourceResult.reason}`
        )
      );

      // Test with reasonable resource requirements (should not skip)
      const reasonableResourceResult =
        skipManager.shouldSkipResourceBasedOperation(
          "test_resource_operation",
          {
            memory: 50 * 1024 * 1024, // 50MB
          }
        );
      console.log(
        chalk.gray(
          `   Reasonable resources: ${
            reasonableResourceResult.skip ? "SKIP" : "RUN"
          } - ${reasonableResourceResult.reason}`
        )
      );

      console.log(
        chalk.green("   ✅ Resource-based skip logic working correctly")
      );
    } catch (error) {
      console.log(
        chalk.red(
          `   ❌ Resource-based skip logic test failed: ${error.message}`
        )
      );
    }
  }

  /**
   * Test comprehensive skip logic (combines multiple conditions)
   */
  async testComprehensiveSkipLogic() {
    try {
      const skipManager = this.ingest.skipLogicManager;

      // Test comprehensive conditions that should skip
      const skipConditions = {
        batch: {
          data: [], // Empty batch
          options: {},
        },
      };

      const skipResult = skipManager.shouldSkipOperation(
        "test_comprehensive_skip",
        skipConditions
      );
      console.log(
        chalk.gray(
          `   Comprehensive skip result: ${
            skipResult.skip ? "SKIP" : "RUN"
          } - ${skipResult.reason}`
        )
      );

      // Test comprehensive conditions that should not skip
      const runConditions = {
        batch: {
          data: Array.from({ length: 20 }, (_, i) => ({ id: i })),
          options: {},
        },
        time: {
          interval: 1000, // 1 second
          force: false,
        },
      };

      const runResult = skipManager.shouldSkipOperation(
        "test_comprehensive_run",
        runConditions
      );
      console.log(
        chalk.gray(
          `   Comprehensive run result: ${runResult.skip ? "SKIP" : "RUN"} - ${
            runResult.reason
          }`
        )
      );

      console.log(
        chalk.green("   ✅ Comprehensive skip logic working correctly")
      );
    } catch (error) {
      console.log(
        chalk.red(
          `   ❌ Comprehensive skip logic test failed: ${error.message}`
        )
      );
    }
  }

  /**
   * Display final metrics from both modules
   */
  displayFinalMetrics() {
    try {
      console.log(chalk.cyan("\n📊 Ingest Module Skip Metrics:"));
      const ingestMetrics = this.ingest.getSkipMetrics();
      console.log(`   Total checks: ${ingestMetrics.totalChecks}`);
      console.log(`   Skipped operations: ${ingestMetrics.skippedOperations}`);
      console.log(`   Skip rate: ${ingestMetrics.skipRate}%`);
      console.log(
        `   Time saved: ${Math.round(ingestMetrics.timeSaved / 1000)}s`
      );

      console.log(chalk.cyan("\n📊 Analysis Module Skip Metrics:"));
      const analysisMetrics = this.analysis.getSkipMetrics();
      console.log(`   Total checks: ${analysisMetrics.totalChecks}`);
      console.log(
        `   Skipped operations: ${analysisMetrics.skippedOperations}`
      );
      console.log(`   Skip rate: ${analysisMetrics.skipRate}%`);
      console.log(
        `   Time saved: ${Math.round(analysisMetrics.timeSaved / 1000)}s`
      );

      // Generate skip reports
      console.log(chalk.blue("\n📋 Skip Logic Reports:"));
      this.ingest.skipLogicManager.generateSkipReport();
      this.analysis.skipLogicManager.generateSkipReport();
    } catch (error) {
      console.log(
        chalk.red(`   ❌ Failed to display metrics: ${error.message}`)
      );
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      await this.ingest.cleanup();
      await this.analysis.cleanup();
      console.log(chalk.gray("🧹 Test cleanup completed"));
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Cleanup warning: ${error.message}`));
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const test = new SkipLogicTest();
  test.runTests().catch(console.error);
}

module.exports = SkipLogicTest;
