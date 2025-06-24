/**
 * Performance Benchmark CLI Command
 *
 * Runs comprehensive performance analysis of the data ingest module
 */

const chalk = require("chalk");
const IngestBenchmark = require("../performance/ingest-benchmark");
const ErrorHandler = require("../utils/errorHandler");

/**
 * Execute the benchmark command
 */
async function benchmarkCommand(options = {}) {
  try {
    console.log(chalk.blue("🔬 Spotify Organizer - Performance Benchmark"));
    console.log(
      chalk.gray(
        "Analyzing data ingest performance and optimization opportunities...\n"
      )
    );

    const {
      export: exportResults = false,
      format = "console",
      outputFile = "performance-results.json",
    } = options;

    // Initialize benchmark suite
    const benchmark = new IngestBenchmark();

    // Run comprehensive benchmark
    const results = await benchmark.runFullBenchmark();

    // Export results if requested
    if (exportResults) {
      benchmark.exportResults(outputFile);
    }

    // Format and display results
    if (format === "json") {
      console.log(JSON.stringify(results, null, 2));
    } else {
      displayBenchmarkSummary(results);
    }

    return {
      success: true,
      results,
      recommendations: results.optimizationSuggestions,
    };
  } catch (error) {
    ErrorHandler.handleGeneralError(error, "Performance Benchmark");
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Display formatted benchmark summary
 */
function displayBenchmarkSummary(results) {
  console.log(chalk.blue("\n📊 Benchmark Summary"));
  console.log("=".repeat(50));

  // Performance overview
  const targetTest = results.loadTests.find((t) => t.trackCount === 1500);
  if (targetTest) {
    const timeInSeconds = targetTest.totalTime / 1000;
    const statusIcon = timeInSeconds <= 180 ? "✅" : "❌";
    const statusText =
      timeInSeconds <= 180
        ? chalk.green("MEETS TARGET")
        : chalk.red("EXCEEDS TARGET");

    console.log(`${statusIcon} Target Performance (1500 tracks):`);
    console.log(`   Time: ${timeInSeconds.toFixed(1)}s ${statusText}`);
    console.log(
      `   Memory: ${(targetTest.memoryPerTrack / 1024).toFixed(1)}KB/track`
    );
    console.log(`   API Efficiency: ${targetTest.apiCalls} calls`);
  }

  // Key metrics
  if (results.loadTests.length > 0) {
    console.log("\n📈 Performance Scaling:");
    results.loadTests.forEach((test) => {
      const efficiency = test.trackCount / (test.totalTime / 1000);
      console.log(
        `   ${test.trackCount
          .toString()
          .padStart(4)} tracks: ${efficiency.toFixed(1)} tracks/sec`
      );
    });
  }

  // Optimization recommendations
  if (results.optimizationSuggestions.length > 0) {
    console.log(chalk.yellow("\n⚡ Optimization Opportunities:"));
    results.optimizationSuggestions.forEach((suggestion, index) => {
      const priority =
        suggestion.severity === "high"
          ? "🔴"
          : suggestion.severity === "medium"
          ? "🟡"
          : "🟢";
      console.log(`${priority} ${suggestion.message}`);
    });
  } else {
    console.log(
      chalk.green("\n🎉 Performance is optimal - no improvements needed!")
    );
  }

  console.log(
    chalk.gray("\nRun with --export flag to save detailed results to file.")
  );
}

module.exports = benchmarkCommand;
