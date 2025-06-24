/**
 * Analyze Command
 *
 * Implements the `spotify-organizer analyze` CLI command
 * Discovers intuitive grouping labels based on track metadata and audio features
 */

const chalk = require("chalk");
const MusicAnalysis = require("../lib/analysis");
const ErrorHandler = require("../utils/errorHandler");

/**
 * Execute the analyze command
 */
async function analyzeCommand(options = {}) {
  const analysis = new MusicAnalysis();

  try {
    console.log(chalk.cyan("🎵 Spotify Organizer - Music Analysis"));
    console.log(
      chalk.gray("Discovering playlist grouping patterns from your library\n")
    );

    // Initialize analysis module
    const initialized = await analysis.initialize();
    if (!initialized) {
      throw new Error("Failed to initialize analysis module");
    }

    // Extract options
    const {
      minTracks = 15,
      showDetails = false,
      exportResults = false,
    } = options;

    console.log(chalk.white(`📋 Analysis Configuration:`));
    console.log(chalk.gray(`   • Minimum tracks per group: ${minTracks}`));
    console.log(
      chalk.gray(`   • Show detailed breakdown: ${showDetails ? "Yes" : "No"}`)
    );
    console.log(
      chalk.gray(`   • Export results: ${exportResults ? "Yes" : "No"}\n`)
    );

    // Run the analysis
    const results = await analysis.analyzeLibrary({ minTracks });

    // Display results
    displayAnalysisResults(results, showDetails);

    // Export if requested
    if (exportResults) {
      await exportAnalysisResults(results);
    }

    // Display recommendations
    displayRecommendations(results);

    return results;
  } catch (error) {
    ErrorHandler.handleGenericError(error, "Music Analysis");
    throw error;
  } finally {
    await analysis.cleanup();
  }
}

/**
 * Display analysis results in a formatted table
 */
function displayAnalysisResults(results, showDetails = false) {
  console.log(chalk.green("\n📊 Analysis Results Summary"));
  console.log(chalk.gray("=" * 50));

  const summary = {
    "Total Tracks": results.totalTracks,
    "Genre Groups": results.genres.length,
    "Decade Groups": results.decades.length,
    "BPM Groups": results.bpmBands.length,
    "Energy Groups": results.energyQuartiles.length,
    "Total Groups":
      results.genres.length +
      results.decades.length +
      results.bpmBands.length +
      results.energyQuartiles.length,
  };

  // Display summary table
  Object.entries(summary).forEach(([key, value]) => {
    console.log(chalk.white(`${key.padEnd(15)}: ${chalk.cyan(value)}`));
  });

  if (showDetails) {
    displayDetailedResults(results);
  }
}

/**
 * Display detailed breakdown of each category
 */
function displayDetailedResults(results) {
  // Genre Groups
  if (results.genres.length > 0) {
    console.log(chalk.blue("\n🎭 Genre Groups"));
    console.log(chalk.gray("-".repeat(40)));
    results.genres.forEach((group) => {
      console.log(
        chalk.white(
          `${group.label.padEnd(25)}: ${chalk.cyan(group.trackCount)} tracks`
        )
      );
    });
  }

  // Decade Groups
  if (results.decades.length > 0) {
    console.log(chalk.blue("\n📅 Decade Groups"));
    console.log(chalk.gray("-".repeat(40)));
    results.decades.forEach((group) => {
      console.log(
        chalk.white(
          `${group.label.padEnd(25)}: ${chalk.cyan(group.trackCount)} tracks`
        )
      );
    });
  }

  // BPM Groups
  if (results.bpmBands.length > 0) {
    console.log(chalk.blue("\n🥁 BPM Groups"));
    console.log(chalk.gray("-".repeat(40)));
    results.bpmBands.forEach((group) => {
      console.log(
        chalk.white(
          `${group.label.padEnd(25)}: ${chalk.cyan(
            group.trackCount
          )} tracks (Avg: ${group.avgBPM} BPM)`
        )
      );
    });
  }

  // Energy Groups
  if (results.energyQuartiles.length > 0) {
    console.log(chalk.blue("\n⚡ Energy Groups"));
    console.log(chalk.gray("-".repeat(40)));
    results.energyQuartiles.forEach((group) => {
      console.log(
        chalk.white(
          `${group.label.padEnd(25)}: ${chalk.cyan(
            group.trackCount
          )} tracks (Avg: ${group.avgEnergy}% energy)`
        )
      );
    });
  }
}

/**
 * Export analysis results to JSON file
 */
async function exportAnalysisResults(results) {
  try {
    const fs = require("fs").promises;
    const path = require("path");

    // Create analysis directory if it doesn't exist
    const analysisDir = path.join(process.cwd(), "analysis");
    await fs.mkdir(analysisDir, { recursive: true });

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `analysis-results-${timestamp}.json`;
    const filepath = path.join(analysisDir, filename);

    // Write results to file
    await fs.writeFile(filepath, JSON.stringify(results, null, 2));

    console.log(chalk.green(`\n💾 Results exported to: ${filepath}`));
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Failed to export results: ${error.message}`));
  }
}

/**
 * Display recommendations based on analysis results
 */
function displayRecommendations(results) {
  console.log(chalk.yellow("\n💡 Recommendations"));
  console.log(chalk.gray("-".repeat(40)));

  const totalGroups =
    results.genres.length +
    results.decades.length +
    results.bpmBands.length +
    results.energyQuartiles.length;

  if (totalGroups === 0) {
    console.log(chalk.red("❌ No groups found. Try:"));
    console.log(
      chalk.white("   • Lower the minimum tracks threshold (--min-tracks)")
    );
    console.log(
      chalk.white("   • Run scan with --extended-mode for audio features")
    );
    console.log(
      chalk.white("   • Check if you have liked songs in your library")
    );
    return;
  }

  if (totalGroups < 5) {
    console.log(chalk.yellow("⚠️  Few groups detected. Consider:"));
    console.log(chalk.white("   • Lowering --min-tracks threshold"));
    console.log(chalk.white("   • Adding more variety to your music library"));
  }

  if (results.bpmBands.length === 0 || results.energyQuartiles.length === 0) {
    console.log(chalk.yellow("⚠️  Missing audio features. Run:"));
    console.log(chalk.cyan("   npm start scan --extended-mode"));
    console.log(
      chalk.white("   This will enable BPM and energy-based grouping")
    );
  }

  if (totalGroups >= 5) {
    console.log(chalk.green("✅ Great analysis results! You can now:"));
    console.log(chalk.white("   • Generate playlists based on these groups"));
    console.log(
      chalk.white("   • Fine-tune grouping with different --min-tracks values")
    );
    console.log(chalk.white("   • Export results for external analysis"));
  }

  console.log(
    chalk.gray(`\n🚀 Next step: Run 'npm start generate' to create playlists`)
  );
}

/**
 * Validate command options
 */
function validateOptions(options) {
  const { minTracks } = options;

  if (minTracks && (minTracks < 1 || minTracks > 1000)) {
    throw new Error("--min-tracks must be between 1 and 1000");
  }

  return true;
}

module.exports = analyzeCommand;
