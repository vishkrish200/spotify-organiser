/**
 * Scan Command - Fetch and cache all liked songs from Spotify
 *
 * Usage: spotify-organizer scan [--extended-mode]
 */

const chalk = require("chalk");
const SpotifyIngest = require("../lib/ingest");
const ErrorHandler = require("../utils/errorHandler");

/**
 * Main scan command implementation
 */
async function scanCommand(options = {}) {
  let ingest = null;

  try {
    console.log(chalk.cyan("🎵 Spotify Organizer - Liked Songs Scanner"));
    console.log(chalk.gray("═".repeat(50)));

    // Initialize the ingest module
    ingest = new SpotifyIngest();
    const initialized = await ingest.initialize();

    if (!initialized) {
      console.log(
        chalk.red("\n❌ Failed to initialize. Please check your setup:")
      );
      console.log(chalk.white("1. Run: spotify-organizer auth"));
      console.log(chalk.white("2. Ensure you have valid Spotify credentials"));
      process.exit(1);
    }

    // Display scan configuration
    displayScanInfo(options);

    // Check for existing data
    const existingStats = await ingest.getDatabaseStats();
    if (existingStats && existingStats.tracks > 0) {
      console.log(
        chalk.yellow(
          `📦 Found ${existingStats.tracks} cached tracks from previous scans`
        )
      );
      console.log(
        chalk.gray(
          `   Albums: ${existingStats.albums} | Artists: ${existingStats.artists} | Genres: ${existingStats.genres}`
        )
      );

      if (existingStats.lastScan) {
        const lastScanDate = new Date(existingStats.lastScan).toLocaleString();
        console.log(chalk.gray(`   Last scan: ${lastScanDate}`));
      }
      console.log();
    }

    // Start the scan
    console.log(chalk.blue("🚀 Starting scan operation..."));
    const startTime = Date.now();

    const result = await ingest.fetchAllLikedSongs({
      extendedMode: options.extendedMode || false,
      onProgress: (progress) => {
        // Optional: Could add additional progress logging here
      },
    });

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    // Display results
    if (result.success) {
      displaySuccessResults(result, duration, options);
    } else {
      displayErrorResults(result);
      process.exit(1);
    }
  } catch (error) {
    console.log(chalk.red("\n💥 Scan failed with unexpected error:"));
    ErrorHandler.handleGenericError(error, "Scan Command");
    process.exit(1);
  } finally {
    // Clean up resources
    if (ingest) {
      await ingest.cleanup();
    }
  }
}

/**
 * Display scan configuration information
 */
function displayScanInfo(options) {
  console.log(chalk.white("📋 Scan Configuration:"));
  console.log(
    chalk.gray(
      `   Mode: ${
        options.extendedMode
          ? "Extended (with audio features & genres)"
          : "Standard (tracks only)"
      }`
    )
  );
  console.log(chalk.gray(`   Batch Size: 50 tracks per request`));
  console.log(chalk.gray(`   Database: SQLite caching enabled`));
  console.log();
}

/**
 * Display successful scan results
 */
function displaySuccessResults(result, duration, options) {
  console.log(chalk.green("\n🎉 Scan completed successfully!"));
  console.log(chalk.gray("═".repeat(50)));

  // Basic statistics
  console.log(chalk.white("📊 Scan Statistics:"));
  console.log(chalk.gray(`   Total Tracks Found: ${result.tracks.length}`));
  console.log(chalk.gray(`   Duration: ${duration.toFixed(1)} seconds`));
  console.log(
    chalk.gray(
      `   Average Speed: ${(result.tracks.length / duration).toFixed(
        1
      )} tracks/sec`
    )
  );

  if (result.stats) {
    if (result.stats.tracksAdded > 0) {
      console.log(
        chalk.green(`   ✅ New Tracks Added: ${result.stats.tracksAdded}`)
      );
    }
    if (result.stats.tracksUpdated > 0) {
      console.log(
        chalk.yellow(`   📝 Tracks Updated: ${result.stats.tracksUpdated}`)
      );
    }
  }

  // Extended mode statistics
  if (options.extendedMode && result.extendedData) {
    console.log(chalk.white("\n🎛️  Extended Data:"));

    const genreCount = Object.keys(result.extendedData.genres || {}).length;
    const audioFeaturesCount = Object.keys(
      result.extendedData.audioFeatures || {}
    ).length;

    if (genreCount > 0) {
      console.log(chalk.gray(`   🎤 Artist Genres: ${genreCount} artists`));

      // Show some sample genres
      const allGenres = Object.values(result.extendedData.genres || {})
        .flat()
        .filter((genre, index, array) => array.indexOf(genre) === index)
        .slice(0, 8);

      if (allGenres.length > 0) {
        console.log(
          chalk.gray(
            `   📋 Sample Genres: ${allGenres.join(", ")}${
              allGenres.length <
              Object.values(result.extendedData.genres || {}).flat().length
                ? "..."
                : ""
            }`
          )
        );
      }
    }

    if (audioFeaturesCount > 0) {
      console.log(
        chalk.gray(`   🎵 Audio Features: ${audioFeaturesCount} tracks`)
      );

      // Calculate some basic audio feature stats
      const audioFeatures = Object.values(
        result.extendedData.audioFeatures || {}
      );
      if (audioFeatures.length > 0) {
        const avgTempo =
          audioFeatures.reduce((sum, f) => sum + (f.tempo || 0), 0) /
          audioFeatures.length;
        const avgEnergy =
          audioFeatures.reduce((sum, f) => sum + (f.energy || 0), 0) /
          audioFeatures.length;

        console.log(
          chalk.gray(`   🥁 Average Tempo: ${avgTempo.toFixed(0)} BPM`)
        );
        console.log(
          chalk.gray(`   ⚡ Average Energy: ${(avgEnergy * 100).toFixed(0)}%`)
        );
      }
    }
  }

  // Performance assessment
  console.log(chalk.white("\n🎯 Performance Assessment:"));
  const targetTime = 180; // 3 minutes = 180 seconds

  if (duration <= targetTime) {
    console.log(
      chalk.green(
        `   ✅ Excellent! Completed within target time (${targetTime}s)`
      )
    );
  } else {
    console.log(
      chalk.yellow(
        `   ⚠️  Took longer than target (${targetTime}s), but still acceptable`
      )
    );
  }

  // Performance recommendations
  if (duration > targetTime) {
    console.log(chalk.white("\n💡 Performance Tips:"));
    console.log(
      chalk.gray(
        "   • Run scans during off-peak hours for better API response times"
      )
    );
    console.log(
      chalk.gray("   • Use standard mode if you don't need audio features")
    );
    console.log(
      chalk.gray(
        "   • Subsequent scans will be faster (only new tracks processed)"
      )
    );
  }

  // Next steps
  console.log(chalk.white("\n🚀 Next Steps:"));
  console.log(chalk.gray("   • Run: spotify-organizer analyze"));
  console.log(chalk.gray("   • Then: spotify-organizer preview"));
  console.log(chalk.gray("   • Finally: spotify-organizer generate --confirm"));

  if (result.scanId) {
    console.log(
      chalk.gray(`\n📋 Scan ID: ${result.scanId} (for troubleshooting)`)
    );
  }
}

/**
 * Display error results
 */
function displayErrorResults(result) {
  console.log(chalk.red("\n❌ Scan failed"));
  console.log(chalk.gray("═".repeat(50)));

  if (result.error) {
    console.log(chalk.white("Error Details:"));
    console.log(chalk.red(`   ${result.error}`));
  }

  console.log(chalk.white("\n🔧 Troubleshooting:"));
  console.log(chalk.gray("   1. Check your internet connection"));
  console.log(
    chalk.gray(
      "   2. Verify your Spotify authentication: spotify-organizer auth"
    )
  );
  console.log(chalk.gray("   3. Try running the scan again"));
  console.log(
    chalk.gray(
      "   4. If issues persist, try standard mode (remove --extended-mode)"
    )
  );
}

/**
 * Display sample tracks for verification
 */
function displaySampleTracks(tracks, count = 5) {
  if (!tracks || tracks.length === 0) return;

  console.log(
    chalk.white(
      `\n🎵 Sample Tracks (${Math.min(count, tracks.length)} of ${
        tracks.length
      }):`
    )
  );

  tracks.slice(0, count).forEach((item, index) => {
    const track = item.track;
    if (track) {
      const artists = track.artists.map((a) => a.name).join(", ");
      const duration = formatDuration(track.duration_ms);
      console.log(
        chalk.gray(`   ${index + 1}. ${track.name} - ${artists} (${duration})`)
      );
    }
  });

  if (tracks.length > count) {
    console.log(chalk.gray(`   ... and ${tracks.length - count} more`));
  }
}

/**
 * Format duration from milliseconds to mm:ss
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Status command - show current database status
 */
async function statusCommand() {
  let ingest = null;

  try {
    console.log(chalk.cyan("🎵 Spotify Organizer - Status"));
    console.log(chalk.gray("═".repeat(50)));

    ingest = new SpotifyIngest();
    const initialized = await ingest.initialize();

    if (!initialized) {
      console.log(chalk.red("❌ Not initialized. Run: spotify-organizer auth"));
      return;
    }

    // Get database statistics
    const stats = await ingest.getDatabaseStats();

    if (!stats || stats.tracks === 0) {
      console.log(chalk.yellow("📭 No cached data found"));
      console.log(chalk.white("   Run: spotify-organizer scan"));
      return;
    }

    // Display current status
    console.log(chalk.white("📊 Current Status:"));
    console.log(chalk.gray(`   Cached Tracks: ${stats.tracks}`));
    console.log(chalk.gray(`   Albums: ${stats.albums}`));
    console.log(chalk.gray(`   Artists: ${stats.artists}`));
    console.log(chalk.gray(`   Genres: ${stats.genres}`));
    console.log(chalk.gray(`   Audio Features: ${stats.audioFeatures}`));

    if (stats.lastScan) {
      const lastScanDate = new Date(stats.lastScan).toLocaleString();
      console.log(chalk.gray(`   Last Scan: ${lastScanDate}`));
    }

    // Get recent scan history
    const scanHistory = await ingest.getScanHistory();

    if (scanHistory && scanHistory.length > 0) {
      console.log(chalk.white("\n📋 Recent Scans:"));

      scanHistory.slice(0, 3).forEach((scan, index) => {
        const date = new Date(scan.startTime).toLocaleDateString();
        const time = new Date(scan.startTime).toLocaleTimeString();
        const duration = scan.duration ? `${scan.duration}s` : "N/A";
        const status =
          scan.status === "completed"
            ? "✅"
            : scan.status === "failed"
            ? "❌"
            : "⏳";

        console.log(
          chalk.gray(
            `   ${status} ${date} ${time} - ${scan.scanType} (${scan.tracksProcessed} tracks, ${duration})`
          )
        );
      });
    }

    // Health check
    const hasExtendedData = stats.audioFeatures > 0 || stats.genres > 0;
    console.log(chalk.white("\n🔍 Data Health:"));
    console.log(
      chalk.gray(
        `   Basic Data: ${stats.tracks > 0 ? "✅ Available" : "❌ Missing"}`
      )
    );
    console.log(
      chalk.gray(
        `   Extended Data: ${
          hasExtendedData ? "✅ Available" : "⚠️  Run with --extended-mode"
        }`
      )
    );
  } catch (error) {
    ErrorHandler.handleGenericError(error, "Status Command");
  } finally {
    if (ingest) {
      await ingest.cleanup();
    }
  }
}

module.exports = {
  scanCommand,
  statusCommand,
  displaySampleTracks,
  formatDuration,
};
