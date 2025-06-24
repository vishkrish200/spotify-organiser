/**
 * Preview Command
 *
 * Shows a preview of playlists that would be created, with confirmation
 * and dry-run capabilities. Uses TableDisplay for formatted output.
 */

const chalk = require("chalk");
const inquirer = require("inquirer");
// const lockfile = require("proper-lockfile");
const path = require("path");
const fs = require("fs").promises;
const TableDisplay = require("../lib/tableDisplay");
const MusicAnalysis = require("../lib/analysis");
const SpotifyIngest = require("../lib/ingest");
const DatabaseManager = require("../lib/database");

class PreviewCommand {
  constructor() {
    this.tableDisplay = new TableDisplay();
    this.lockfilePath = path.join(process.cwd(), ".spotify-organizer.lock");
  }

  /**
   * Main preview command handler
   */
  async execute(options = {}) {
    const {
      confirm = false,
      dryRun = false,
      minTracks = 15,
      maxPlaylists = 25,
      details = false,
      format = "table",
      output = null,
    } = options;

    try {
      // Check for concurrent runs
      await this.acquireLock();

      console.log(
        this.tableDisplay.createSectionHeader(
          "🎵 Spotify Organizer Preview",
          dryRun ? "Dry Run Mode - No changes will be made" : "Preview Mode"
        )
      );

      // Step 1: Validate prerequisites
      await this.validatePrerequisites();

      // Step 2: Load and analyze data
      const analysisData = await this.loadAnalysisData();

      // Step 3: Generate playlist preview
      const playlistPreview = await this.generatePlaylistPreview(analysisData, {
        minTracks,
        maxPlaylists,
      });

      // Step 4: Display preview
      await this.displayPreview(playlistPreview, { details, format });

      // Step 5: Handle confirmation (if not in dry-run mode)
      if (!dryRun) {
        const shouldProceed = await this.handleConfirmation(
          playlistPreview,
          confirm
        );

        if (shouldProceed) {
          console.log(chalk.green("\n✅ Preview approved!"));
          console.log(
            chalk.gray(
              "Run 'spotify-organizer generate' to create these playlists."
            )
          );
        } else {
          console.log(chalk.yellow("\n⏸️  Preview cancelled by user."));
        }
      }

      // Step 6: Export results if requested
      if (output) {
        await this.exportResults(playlistPreview, output, format);
      }

      return playlistPreview;
    } catch (error) {
      console.error(chalk.red(`❌ Preview failed: ${error.message}`));
      throw error;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Validate that required data exists
   */
  async validatePrerequisites() {
    console.log(chalk.cyan("🔍 Validating prerequisites..."));

    const db = new DatabaseManager();
    await db.initialize();

    try {
      // Check if we have cached tracks
      const trackCount = await db.getTrackCount();
      if (trackCount === 0) {
        throw new Error(
          "No cached tracks found. Run 'spotify-organizer scan' first."
        );
      }

      // Check if we have analysis data
      const analysisExists = await db.hasAnalysisData();
      if (!analysisExists) {
        throw new Error(
          "No analysis data found. Run 'spotify-organizer analyze' first."
        );
      }

      console.log(
        chalk.green(`✅ Found ${trackCount} cached tracks with analysis data`)
      );
    } finally {
      await db.disconnect();
    }
  }

  /**
   * Load analysis data from database
   */
  async loadAnalysisData() {
    console.log(chalk.cyan("📊 Loading analysis data..."));

    const analysis = new MusicAnalysis();
    const analysisData = await analysis.getStoredAnalysis();

    if (!analysisData || Object.keys(analysisData).length === 0) {
      throw new Error(
        "No analysis data available. Run 'spotify-organizer analyze' first."
      );
    }

    console.log(
      chalk.green(
        `✅ Loaded analysis data for ${analysisData.totalTracks} tracks`
      )
    );

    return analysisData;
  }

  /**
   * Generate playlist preview from analysis data
   */
  async generatePlaylistPreview(analysisData, options = {}) {
    const { minTracks = 15, maxPlaylists = 25 } = options;

    console.log(chalk.cyan("🎨 Generating playlist preview..."));

    const playlists = [];

    // Helper function to create playlist from analysis category
    const createPlaylist = (category, type, data) => {
      if (data.trackCount >= minTracks) {
        return {
          name: this.generatePlaylistName(category, type),
          trackCount: data.trackCount,
          categories: [category, type],
          status: "new", // TODO: Check if playlist exists in Spotify
          avgDuration: data.avgDuration || 210000, // Default 3:30
          tracks: data.tracks || [],
          type: type,
          categoryData: data,
        };
      }
      return null;
    };

    // Process genres
    if (analysisData.genres) {
      analysisData.genres.forEach((genre) => {
        const playlist = createPlaylist(genre.label, "genre", genre);
        if (playlist) playlists.push(playlist);
      });
    }

    // Process decades
    if (analysisData.decades) {
      analysisData.decades.forEach((decade) => {
        const playlist = createPlaylist(decade.label, "decade", decade);
        if (playlist) playlists.push(playlist);
      });
    }

    // Process BPM bands
    if (analysisData.bpmBands) {
      analysisData.bpmBands.forEach((bpm) => {
        const playlist = createPlaylist(bpm.label, "bpm", bpm);
        if (playlist) playlists.push(playlist);
      });
    }

    // Process energy quartiles
    if (analysisData.energyQuartiles) {
      analysisData.energyQuartiles.forEach((energy) => {
        const playlist = createPlaylist(energy.label, "energy", energy);
        if (playlist) playlists.push(playlist);
      });
    }

    // Sort by track count (descending) and limit
    playlists.sort((a, b) => b.trackCount - a.trackCount);
    const limitedPlaylists = playlists.slice(0, maxPlaylists);

    console.log(
      chalk.green(
        `✅ Generated ${limitedPlaylists.length} playlist previews (${playlists.length} total possible)`
      )
    );

    return {
      playlists: limitedPlaylists,
      totalPossiblePlaylists: playlists.length,
      totalTracks: analysisData.totalTracks,
      filteredByMinTracks: playlists.length - limitedPlaylists.length,
      summary: this.generateSummary(limitedPlaylists, analysisData),
    };
  }

  /**
   * Generate a playlist name from category and type
   */
  generatePlaylistName(category, type) {
    const prefixes = {
      genre: "🎵",
      decade: "📅",
      bpm: "⚡",
      energy: "🔥",
    };

    const prefix = prefixes[type] || "🎵";

    // Clean up category name
    const cleanCategory = category
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return `${prefix} ${cleanCategory}`;
  }

  /**
   * Display the playlist preview
   */
  async displayPreview(previewData, options = {}) {
    const { details = false, format = "table" } = options;

    console.log(
      this.tableDisplay.createSectionHeader(
        "Playlist Preview",
        `${previewData.playlists.length} playlists will be created`
      )
    );

    if (format === "table") {
      // Main playlist table
      const playlistTable = this.tableDisplay.createPlaylistPreview(
        previewData.playlists,
        {
          showSamples: details,
          maxSamples: details ? 3 : 0,
          showStats: true,
        }
      );

      console.log(playlistTable);

      // Summary statistics
      if (details) {
        console.log(
          this.tableDisplay.createSectionHeader("Summary Statistics")
        );
        const summaryTable = this.tableDisplay.createSummaryTable(
          previewData.summary
        );
        console.log(summaryTable);
      }
    } else if (format === "json") {
      console.log(JSON.stringify(previewData, null, 2));
    }

    // Show any warnings or notices
    if (previewData.filteredByMinTracks > 0) {
      console.log(
        chalk.yellow(
          `\n⚠️  ${previewData.filteredByMinTracks} additional playlists were excluded (< 15 tracks each)`
        )
      );
    }

    if (previewData.totalPossiblePlaylists > previewData.playlists.length) {
      console.log(
        chalk.gray(
          `\n💡 ${
            previewData.totalPossiblePlaylists - previewData.playlists.length
          } more playlists are possible. Use --max-playlists to see more.`
        )
      );
    }
  }

  /**
   * Handle user confirmation
   */
  async handleConfirmation(previewData, autoConfirm = false) {
    if (autoConfirm) {
      console.log(chalk.green("\n✅ Auto-confirmed with --confirm flag"));
      return true;
    }

    console.log(this.tableDisplay.createSectionHeader("Confirmation Required"));

    const confirmationTable = this.tableDisplay.createConfirmationDialog(
      "create",
      previewData.playlists,
      {
        showDetails: true,
        maxItems: 5,
      }
    );

    console.log(confirmationTable);

    const answers = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: `Do you want to create these ${previewData.playlists.length} playlists?`,
        default: false,
      },
    ]);

    return answers.proceed;
  }

  /**
   * Generate summary statistics
   */
  generateSummary(playlists, analysisData) {
    const totalPlaylistTracks = playlists.reduce(
      (sum, p) => sum + p.trackCount,
      0
    );

    const avgTracksPerPlaylist = Math.round(
      totalPlaylistTracks / playlists.length
    );

    const typeBreakdown = playlists.reduce((acc, p) => {
      acc[p.type] = (acc[p.type] || 0) + 1;
      return acc;
    }, {});

    return {
      totalPlaylists: playlists.length,
      totalTracksInPlaylists: totalPlaylistTracks,
      avgTracksPerPlaylist,
      coveragePercentage: (
        (totalPlaylistTracks / analysisData.totalTracks) *
        100
      ).toFixed(1),
      typeBreakdown,
      largestPlaylist: Math.max(...playlists.map((p) => p.trackCount)),
      smallestPlaylist: Math.min(...playlists.map((p) => p.trackCount)),
    };
  }

  /**
   * Export results to file
   */
  async exportResults(previewData, outputPath, format) {
    console.log(chalk.cyan(`📄 Exporting results to ${outputPath}...`));

    let content;
    if (format === "json") {
      content = JSON.stringify(previewData, null, 2);
    } else {
      // Export as text format
      content = this.formatAsText(previewData);
    }

    await fs.writeFile(outputPath, content, "utf8");
    console.log(chalk.green(`✅ Results exported to ${outputPath}`));
  }

  /**
   * Format preview data as text
   */
  formatAsText(previewData) {
    let text = "Spotify Organizer - Playlist Preview\n";
    text += "=".repeat(40) + "\n\n";

    previewData.playlists.forEach((playlist, index) => {
      text += `${index + 1}. ${playlist.name}\n`;
      text += `   Tracks: ${playlist.trackCount}\n`;
      text += `   Categories: ${playlist.categories.join(", ")}\n`;
      text += `   Type: ${playlist.type}\n\n`;
    });

    text += "\nSummary:\n";
    text += `Total Playlists: ${previewData.summary.totalPlaylists}\n`;
    text += `Total Tracks: ${previewData.summary.totalTracksInPlaylists}\n`;
    text += `Coverage: ${previewData.summary.coveragePercentage}%\n`;

    return text;
  }

  /**
   * Acquire lockfile to prevent concurrent runs
   */
  async acquireLock() {
    const os = require("os");

    try {
      // Check if lockfile exists and is stale
      try {
        const lockStats = await fs.stat(this.lockfilePath);
        const now = Date.now();
        const lockAge = now - lockStats.mtime.getTime();

        // If lockfile is older than 5 minutes, consider it stale
        if (lockAge > 5 * 60 * 1000) {
          console.log(chalk.yellow("🧹 Removing stale lockfile..."));
          await fs.unlink(this.lockfilePath);
        } else {
          // Read lockfile to see what process is running
          const lockContent = await fs.readFile(this.lockfilePath, "utf8");
          const lockData = JSON.parse(lockContent);
          throw new Error(
            `Another spotify-organizer instance is running (PID: ${lockData.pid}). Please wait for it to complete.`
          );
        }
      } catch (statError) {
        // If file doesn't exist, we can proceed
        if (statError.code !== "ENOENT") {
          throw statError;
        }
      }

      // Create lockfile with process info
      const lockData = {
        pid: process.pid,
        hostname: os.hostname(),
        timestamp: new Date().toISOString(),
        command: process.argv.join(" "),
      };

      await fs.writeFile(this.lockfilePath, JSON.stringify(lockData, null, 2));
      console.log(chalk.gray("🔒 Acquired lockfile"));
    } catch (error) {
      if (error.message.includes("Another spotify-organizer")) {
        throw error;
      }
      throw new Error(`Failed to acquire lockfile: ${error.message}`);
    }
  }

  /**
   * Release lockfile
   */
  async releaseLock() {
    try {
      // Check if the lockfile is ours before removing it
      try {
        const lockContent = await fs.readFile(this.lockfilePath, "utf8");
        const lockData = JSON.parse(lockContent);

        if (lockData.pid === process.pid) {
          await fs.unlink(this.lockfilePath);
          console.log(chalk.gray("🔓 Released lockfile"));
        } else {
          console.log(chalk.yellow("⚠️  Lockfile belongs to another process"));
        }
      } catch (error) {
        if (error.code === "ENOENT") {
          // Lockfile doesn't exist, which is fine
          console.log(chalk.gray("🔓 Lockfile already removed"));
        } else {
          console.warn(
            chalk.yellow(
              `Warning: Could not release lockfile: ${error.message}`
            )
          );
        }
      }
    } catch (error) {
      console.warn(
        chalk.yellow(`Warning: Could not release lockfile: ${error.message}`)
      );
    }
  }
}

/**
 * Command handler function for CLI
 */
async function previewCommand(options = {}) {
  const preview = new PreviewCommand();
  return await preview.execute(options);
}

module.exports = {
  PreviewCommand,
  previewCommand,
};
