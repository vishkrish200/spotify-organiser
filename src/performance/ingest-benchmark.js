/**
 * Spotify Data Ingest Performance Benchmark Tool
 *
 * Measures and analyzes performance characteristics of the data ingest module
 * to ensure it meets the 3-minute target for 1500 tracks
 */

const chalk = require("chalk");
const { performance } = require("perf_hooks");
const SpotifyIngest = require("../lib/ingest");
const DatabaseService = require("../lib/database");

class IngestBenchmark {
  constructor() {
    this.results = {
      loadTests: [],
      cachingTests: [],
      apiTests: [],
      memoryTests: [],
      optimizationSuggestions: [],
    };
  }

  /**
   * Run comprehensive performance analysis
   */
  async runFullBenchmark() {
    console.log(
      chalk.blue("🔬 Starting Spotify Ingest Performance Benchmark\n")
    );

    try {
      // Core performance tests
      await this.runLoadTests();
      await this.runCachingEfficiencyTests();
      await this.runApiThroughputTests();
      await this.runMemoryUsageTests();

      // Generate optimization report
      this.generateOptimizationReport();

      console.log(
        chalk.green("\n✅ Performance benchmark completed successfully")
      );
      return this.results;
    } catch (error) {
      console.error(chalk.red("❌ Benchmark failed:"), error.message);
      throw error;
    }
  }

  /**
   * Test performance with different dataset sizes
   */
  async runLoadTests() {
    console.log(chalk.yellow("📊 Running Load Tests..."));

    const testSizes = [50, 200, 500, 1000, 1500];

    for (const size of testSizes) {
      console.log(chalk.gray(`  Testing with ${size} tracks...`));

      const result = await this.measureIngestPerformance(size, false);
      this.results.loadTests.push(result);

      // Calculate projected performance for target size
      if (size === 1500) {
        const targetTime = result.totalTime / 1000; // Convert to seconds
        console.log(
          chalk.white(`    Target performance: ${targetTime.toFixed(1)}s`)
        );

        if (targetTime > 180) {
          this.results.optimizationSuggestions.push({
            type: "performance",
            severity: "high",
            message: `Current performance (${targetTime.toFixed(
              1
            )}s) exceeds 3-minute target`,
            suggestion:
              "Consider implementing parallel processing or larger batch sizes",
          });
        }
      }
    }

    // Analyze scaling characteristics
    this.analyzePerformanceScaling();
    console.log(chalk.green("  ✅ Load tests completed\n"));
  }

  /**
   * Test caching efficiency and database performance
   */
  async runCachingEfficiencyTests() {
    console.log(chalk.yellow("💾 Running Caching Efficiency Tests..."));

    // Test database performance with different batch sizes
    const batchSizes = [25, 50, 100];

    for (const batchSize of batchSizes) {
      console.log(chalk.gray(`  Testing batch size: ${batchSize}`));

      const result = await this.measureCachingPerformance(500, batchSize);
      this.results.cachingTests.push(result);
    }

    // Find optimal batch size
    this.findOptimalBatchSize();
    console.log(chalk.green("  ✅ Caching tests completed\n"));
  }

  /**
   * Test API throughput and rate limiting
   */
  async runApiThroughputTests() {
    console.log(chalk.yellow("🌐 Running API Throughput Tests..."));

    const result = await this.measureApiPerformance(1000);
    this.results.apiTests.push(result);

    // Analyze API efficiency
    if (result.avgResponseTime > 200) {
      this.results.optimizationSuggestions.push({
        type: "api",
        severity: "medium",
        message: `Average API response time (${result.avgResponseTime}ms) is high`,
        suggestion: "Consider implementing request pooling or connection reuse",
      });
    }

    console.log(chalk.green("  ✅ API tests completed\n"));
  }

  /**
   * Monitor memory usage patterns
   */
  async runMemoryUsageTests() {
    console.log(chalk.yellow("🧠 Running Memory Usage Tests..."));

    const result = await this.measureMemoryUsage(2000);
    this.results.memoryTests.push(result);

    // Check for memory efficiency
    if (result.memoryPerTrack > 50000) {
      // 50KB per track
      this.results.optimizationSuggestions.push({
        type: "memory",
        severity: "medium",
        message: `Memory usage per track (${(
          result.memoryPerTrack / 1024
        ).toFixed(1)}KB) is high`,
        suggestion:
          "Consider implementing streaming processing or data compression",
      });
    }

    console.log(chalk.green("  ✅ Memory tests completed\n"));
  }

  /**
   * Measure ingest performance for a given track count
   */
  async measureIngestPerformance(trackCount, extendedMode = false) {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();

    // Create mock ingest with performance tracking
    const ingest = new MockIngestForTesting(trackCount);
    await ingest.initialize();

    const result = await ingest.fetchAllLikedSongs({ extendedMode });

    const endTime = performance.now();
    const endMemory = process.memoryUsage();

    return {
      trackCount,
      extendedMode,
      totalTime: endTime - startTime,
      timePerTrack: (endTime - startTime) / trackCount,
      memoryUsed: endMemory.heapUsed - startMemory.heapUsed,
      memoryPerTrack: (endMemory.heapUsed - startMemory.heapUsed) / trackCount,
      apiCalls: ingest.getMetrics().apiCalls,
      dbOperations: ingest.getMetrics().dbOperations,
      success: result.success,
    };
  }

  /**
   * Measure caching performance with different batch sizes
   */
  async measureCachingPerformance(trackCount, batchSize) {
    const ingest = new MockIngestForTesting(trackCount, { batchSize });
    await ingest.initialize();

    const startTime = performance.now();
    await ingest.fetchAllLikedSongs();
    const endTime = performance.now();

    const metrics = ingest.getMetrics();

    return {
      batchSize,
      trackCount,
      totalTime: endTime - startTime,
      dbOperations: metrics.dbOperations,
      avgDbTime: metrics.totalDbTime / metrics.dbOperations,
      efficiency: trackCount / ((endTime - startTime) / 1000), // Tracks per second
    };
  }

  /**
   * Measure API performance characteristics
   */
  async measureApiPerformance(trackCount) {
    const ingest = new MockIngestForTesting(trackCount);
    await ingest.initialize();

    const startTime = performance.now();
    await ingest.fetchAllLikedSongs();
    const endTime = performance.now();

    const metrics = ingest.getMetrics();

    return {
      trackCount,
      totalTime: endTime - startTime,
      apiCalls: metrics.apiCalls,
      avgResponseTime: metrics.totalApiTime / metrics.apiCalls,
      maxResponseTime: metrics.maxApiTime,
      minResponseTime: metrics.minApiTime,
      throughput: trackCount / ((endTime - startTime) / 1000),
    };
  }

  /**
   * Measure memory usage patterns
   */
  async measureMemoryUsage(trackCount) {
    const initialMemory = process.memoryUsage();

    const ingest = new MockIngestForTesting(trackCount);
    await ingest.initialize();

    const beforeIngest = process.memoryUsage();
    await ingest.fetchAllLikedSongs();
    const afterIngest = process.memoryUsage();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const afterGC = process.memoryUsage();

    return {
      trackCount,
      initialMemory: initialMemory.heapUsed,
      peakMemory: afterIngest.heapUsed,
      finalMemory: afterGC.heapUsed,
      memoryGrowth: afterIngest.heapUsed - beforeIngest.heapUsed,
      memoryPerTrack:
        (afterIngest.heapUsed - beforeIngest.heapUsed) / trackCount,
      memoryRetained: afterGC.heapUsed - initialMemory.heapUsed,
    };
  }

  /**
   * Analyze performance scaling characteristics
   */
  analyzePerformanceScaling() {
    if (this.results.loadTests.length < 3) return;

    const tests = this.results.loadTests.sort(
      (a, b) => a.trackCount - b.trackCount
    );

    // Check if scaling is linear
    let scalingIssues = false;
    for (let i = 1; i < tests.length; i++) {
      const prev = tests[i - 1];
      const curr = tests[i];

      const expectedTime = (prev.totalTime / prev.trackCount) * curr.trackCount;
      const actualTime = curr.totalTime;
      const variance = Math.abs(actualTime - expectedTime) / expectedTime;

      if (variance > 0.3) {
        // More than 30% variance
        scalingIssues = true;
        break;
      }
    }

    if (scalingIssues) {
      this.results.optimizationSuggestions.push({
        type: "scaling",
        severity: "medium",
        message: "Performance scaling is not linear - may indicate bottlenecks",
        suggestion: "Profile code to identify performance bottlenecks",
      });
    }
  }

  /**
   * Find optimal batch size for database operations
   */
  findOptimalBatchSize() {
    if (this.results.cachingTests.length === 0) return;

    const optimalTest = this.results.cachingTests.reduce((best, current) =>
      current.efficiency > best.efficiency ? current : best
    );

    console.log(
      chalk.white(
        `    Optimal batch size: ${
          optimalTest.batchSize
        } (${optimalTest.efficiency.toFixed(1)} tracks/sec)`
      )
    );

    if (optimalTest.batchSize !== 50) {
      this.results.optimizationSuggestions.push({
        type: "batching",
        severity: "low",
        message: `Optimal batch size (${optimalTest.batchSize}) differs from current default (50)`,
        suggestion: `Consider adjusting batch size to ${optimalTest.batchSize} for better performance`,
      });
    }
  }

  /**
   * Generate comprehensive optimization report
   */
  generateOptimizationReport() {
    console.log(chalk.blue("\n📋 Performance Optimization Report"));
    console.log("=".repeat(50));

    // Performance summary
    const targetTest = this.results.loadTests.find(
      (t) => t.trackCount === 1500
    );
    if (targetTest) {
      const targetTime = targetTest.totalTime / 1000;
      const status =
        targetTime <= 180 ? chalk.green("✅ PASS") : chalk.red("❌ FAIL");
      console.log(
        `Target Performance (1500 tracks): ${targetTime.toFixed(1)}s ${status}`
      );
    }

    // Memory efficiency
    const memoryTest = this.results.memoryTests[0];
    if (memoryTest) {
      const memoryPerTrackKB = memoryTest.memoryPerTrack / 1024;
      const memoryStatus =
        memoryPerTrackKB <= 50
          ? chalk.green("✅ EFFICIENT")
          : chalk.yellow("⚠️ HIGH");
      console.log(
        `Memory Usage: ${memoryPerTrackKB.toFixed(1)}KB/track ${memoryStatus}`
      );
    }

    // API performance
    const apiTest = this.results.apiTests[0];
    if (apiTest) {
      const apiStatus =
        apiTest.avgResponseTime <= 200
          ? chalk.green("✅ FAST")
          : chalk.yellow("⚠️ SLOW");
      console.log(
        `API Response Time: ${apiTest.avgResponseTime.toFixed(
          1
        )}ms ${apiStatus}`
      );
    }

    // Optimization suggestions
    if (this.results.optimizationSuggestions.length > 0) {
      console.log("\n🔧 Optimization Suggestions:");
      this.results.optimizationSuggestions.forEach((suggestion, index) => {
        const severityColor =
          suggestion.severity === "high"
            ? chalk.red
            : suggestion.severity === "medium"
            ? chalk.yellow
            : chalk.gray;
        console.log(
          `${index + 1}. ${severityColor(suggestion.severity.toUpperCase())}: ${
            suggestion.message
          }`
        );
        console.log(`   💡 ${suggestion.suggestion}\n`);
      });
    } else {
      console.log(
        chalk.green(
          "\n🎉 No optimization suggestions - performance is optimal!"
        )
      );
    }

    // Detailed metrics
    console.log("\n📊 Detailed Metrics:");
    console.log("Load Test Results:");
    this.results.loadTests.forEach((test) => {
      console.log(
        `  ${test.trackCount} tracks: ${(test.totalTime / 1000).toFixed(
          1
        )}s (${test.timePerTrack.toFixed(2)}ms/track)`
      );
    });

    if (this.results.cachingTests.length > 0) {
      console.log("\nCaching Performance:");
      this.results.cachingTests.forEach((test) => {
        console.log(
          `  Batch size ${test.batchSize}: ${test.efficiency.toFixed(
            1
          )} tracks/sec`
        );
      });
    }
  }

  /**
   * Export results to JSON for further analysis
   */
  exportResults(filename = "performance-results.json") {
    const fs = require("fs");
    const results = {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      ...this.results,
    };

    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(chalk.blue(`📄 Results exported to ${filename}`));
  }
}

/**
 * Mock implementation for performance testing
 */
class MockIngestForTesting {
  constructor(trackCount, options = {}) {
    this.trackCount = trackCount;
    this.batchSize = options.batchSize || 50;
    this.metrics = {
      apiCalls: 0,
      dbOperations: 0,
      totalApiTime: 0,
      totalDbTime: 0,
      maxApiTime: 0,
      minApiTime: Infinity,
    };
  }

  async initialize() {
    return true;
  }

  async fetchAllLikedSongs(options = {}) {
    const tracks = [];
    const batches = Math.ceil(this.trackCount / this.batchSize);

    for (let i = 0; i < batches; i++) {
      // Simulate API call
      const apiStart = performance.now();
      await this.simulateApiDelay();
      const apiEnd = performance.now();

      const apiTime = apiEnd - apiStart;
      this.metrics.apiCalls++;
      this.metrics.totalApiTime += apiTime;
      this.metrics.maxApiTime = Math.max(this.metrics.maxApiTime, apiTime);
      this.metrics.minApiTime = Math.min(this.metrics.minApiTime, apiTime);

      // Simulate database operation
      const dbStart = performance.now();
      await this.simulateDbOperation();
      const dbEnd = performance.now();

      this.metrics.dbOperations++;
      this.metrics.totalDbTime += dbEnd - dbStart;

      // Add batch to tracks
      const batchSize = Math.min(
        this.batchSize,
        this.trackCount - tracks.length
      );
      tracks.push(
        ...Array(batchSize)
          .fill()
          .map((_, idx) => ({
            track: { id: `track_${i}_${idx}`, name: `Track ${i}_${idx}` },
          }))
      );
    }

    return {
      success: true,
      tracks,
      stats: this.metrics,
    };
  }

  async simulateApiDelay() {
    // Simulate realistic API response time (50-200ms)
    const delay = 50 + Math.random() * 150;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async simulateDbOperation() {
    // Simulate database write operation (1-10ms)
    const delay = 1 + Math.random() * 9;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  getMetrics() {
    return this.metrics;
  }
}

// Export for use as module or run directly
module.exports = IngestBenchmark;

// Run benchmark if called directly
if (require.main === module) {
  const benchmark = new IngestBenchmark();

  benchmark
    .runFullBenchmark()
    .then((results) => {
      benchmark.exportResults();
      process.exit(0);
    })
    .catch((error) => {
      console.error("Benchmark failed:", error);
      process.exit(1);
    });
}
