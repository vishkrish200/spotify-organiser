/**
 * Generate Command
 *
 * Implements the `spotify-organizer generate` CLI command
 * Creates Spotify playlists based on analysis results
 */

const chalk = require("chalk");
const MusicAnalysis = require("../lib/analysis");
const PlaylistGenerator = require("../lib/playlistGenerator");
const ErrorHandler = require("../utils/errorHandler");

/**
 * Execute the generate command
 */
async function generateCommand(options = {}) {
  const analysis = new MusicAnalysis();
  const generator = new PlaylistGenerator();

  try {
    console.log(chalk.cyan("🎵 Spotify Organizer - Playlist Generator"));
    console.log(
      chalk.gray("Creating playlists from your music analysis results\n")
    );

    // Extract options
    const { dryRun = false, confirm = false, maxPlaylists = 25 } = options;

    console.log(chalk.white(`📋 Generation Configuration:`));
    console.log(
      chalk.gray(
        `   • Mode: ${dryRun ? "Dry Run (preview only)" : "Live Generation"}`
      )
    );
    console.log(chalk.gray(`   • Auto-confirm: ${confirm ? "Yes" : "No"}`));
    console.log(chalk.gray(`   • Max playlists: ${maxPlaylists}\n`));

    // Initialize modules
    console.log(chalk.blue("🔧 Initializing modules..."));

    const analysisInitialized = await analysis.initialize();
    if (!analysisInitialized) {
      throw new Error("Failed to initialize analysis module");
    }

    const generatorInitialized = await generator.initialize();
    if (!generatorInitialized) {
      throw new Error("Failed to initialize playlist generator");
    }

    // Get analysis results (run quick analysis if needed)
    console.log(chalk.blue("📊 Getting analysis results..."));
    const analysisResults = await analysis.analyzeLibrary({ minTracks: 15 });

    if (!analysisResults || analysisResults.totalTracks === 0) {
      throw new Error(
        "No analysis results found. Run 'analyze' command first."
      );
    }

    console.log(
      chalk.green(`✅ Found analysis for ${analysisResults.totalTracks} tracks`)
    );

    // Generate playlists
    const result = await generator.generatePlaylists(analysisResults, {
      dryRun,
      confirm,
      maxPlaylists,
    });

    // Display summary
    displayGenerationSummary(result, dryRun);

    // Next steps
    displayNextSteps(result, dryRun);

    return result;
  } catch (error) {
    ErrorHandler.handleGenericError(error, "Playlist Generation");
    throw error;
  } finally {
    await analysis.cleanup();
    await generator.cleanup();
  }
}

/**
 * Display generation summary
 */
function displayGenerationSummary(result, dryRun) {
  const { stats } = result;

  console.log(chalk.green("\n🎉 Generation Summary"));
  console.log(chalk.gray("=".repeat(40)));

  if (dryRun) {
    console.log(chalk.cyan(`📋 Playlists planned: ${stats.totalOperations}`));
    console.log(
      chalk.white("   This was a preview - no actual playlists were created")
    );
  } else {
    console.log(chalk.cyan(`✅ Playlists created: ${stats.playlistsCreated}`));
    console.log(chalk.cyan(`🔄 Playlists updated: ${stats.playlistsUpdated}`));
    console.log(chalk.cyan(`🎵 Tracks added: ${stats.tracksAdded}`));

    if (stats.errors.length > 0) {
      console.log(chalk.red(`❌ Errors: ${stats.errors.length}`));
      stats.errors.forEach((error) => {
        console.log(chalk.yellow(`   • ${error.group}: ${error.error}`));
      });
    }
  }

  // Show some example playlists created
  if (result.results) {
    const allResults = [
      ...result.results.genres,
      ...result.results.decades,
      ...result.results.bpmBands,
      ...result.results.energyQuartiles,
    ].filter((r) => r.success || r.dryRun);

    if (allResults.length > 0) {
      console.log(chalk.blue("\n🎧 Sample Playlists:"));
      allResults.slice(0, 5).forEach((playlist) => {
        const status = dryRun ? "(preview)" : "✅";
        console.log(
          chalk.white(
            `   ${status} ${playlist.name} (${playlist.trackCount} tracks)`
          )
        );
      });

      if (allResults.length > 5) {
        console.log(chalk.gray(`   ... and ${allResults.length - 5} more`));
      }
    }
  }
}

/**
 * Display next steps and recommendations
 */
function displayNextSteps(result, dryRun) {
  console.log(chalk.yellow("\n💡 Next Steps"));
  console.log(chalk.gray("-".repeat(30)));

  if (dryRun) {
    console.log(chalk.white("To create the actual playlists:"));
    console.log(chalk.cyan("   npm start generate --confirm"));
    console.log(chalk.white("\nOr review and modify the analysis:"));
    console.log(chalk.cyan("   npm start analyze --min-tracks=10 --details"));
  } else if (result.success) {
    console.log(
      chalk.green("🎉 Success! Check your Spotify account for new playlists")
    );
    console.log(chalk.white("\nYou can now:"));
    console.log(
      chalk.cyan("   • Open Spotify to see your organized playlists")
    );
    console.log(chalk.cyan("   • Run analysis again with different settings"));
    console.log(
      chalk.cyan("   • Use 'rollback' if you want to undo these changes")
    );

    if (result.stats.playlistsCreated > 0) {
      console.log(
        chalk.white(
          `\n📱 Tip: Look for playlists with emojis like 🎤, 🏠, 🎬, 💎`
        )
      );
    }
  }

  console.log(chalk.gray(`\n📋 For status and history: npm start status`));
}

/**
 * Validate command options
 */
function validateOptions(options) {
  const { maxPlaylists } = options;

  if (maxPlaylists && (maxPlaylists < 1 || maxPlaylists > 100)) {
    throw new Error("--max-playlists must be between 1 and 100");
  }

  return true;
}

module.exports = generateCommand;
