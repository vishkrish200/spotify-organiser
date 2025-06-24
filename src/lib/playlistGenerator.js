/**
 * Playlist Generation Module
 *
 * Creates Spotify playlists based on music analysis results
 * Handles key generation, templating, collision resolution, and API integration
 */

const crypto = require("crypto");
const emoji = require("node-emoji");
const chalk = require("chalk");
const cliProgress = require("cli-progress");
const SpotifyWebApi = require("spotify-web-api-node");
const DatabaseService = require("./database");
const SpotifyAuth = require("./auth");
const ErrorHandler = require("../utils/errorHandler");
const RetryHandler = require("../utils/retryHandler");

class PlaylistGenerator {
  constructor() {
    this.db = new DatabaseService();
    this.auth = new SpotifyAuth();
    this.spotifyApi = null;

    // Rate limiting configuration
    this.rateLimit = {
      requestsPerSecond: 8, // Conservative limit (Spotify allows 10/sec)
      requestQueue: [],
      isProcessing: false,
      lastRequestTime: 0,
    };

    // Progress tracking
    this.progressBar = null;
    this.stats = {
      playlistsCreated: 0,
      playlistsUpdated: 0,
      tracksAdded: 0,
      totalOperations: 0,
      startTime: null,
      errors: [],
    };

    // Template configuration
    this.templates = {
      genre: {
        template: "{emoji} {genre} Vibes",
        emojis: {
          rap: "🎤",
          "hip hop": "🎤",
          edm: "🎧",
          house: "🏠",
          bollywood: "🎬",
          desi: "🇮🇳",
          pop: "⭐",
          "r&b": "💖",
          drill: "🔥",
          grime: "⚡",
          afro: "🌍",
          default: "🎵",
        },
      },
      decade: {
        template: "{emoji} {decade} Hits",
        emojis: {
          "1970s": "✨",
          "1980s": "💫",
          "1990s": "🌟",
          "2000s": "🚀",
          "2010s": "💎",
          "2020s": "🔥",
          default: "📀",
        },
      },
      bpm: {
        template: "{emoji} {bpmRange}",
        emojis: {
          "Slow & Chill": "😌",
          "Mid-Tempo": "🚶",
          Upbeat: "🏃",
          "High Energy": "⚡",
          "Electronic/Dance": "💃",
          default: "🥁",
        },
      },
      energy: {
        template: "{emoji} {energyLevel} Energy",
        emojis: {
          Mellow: "🌙",
          Relaxed: "☀️",
          Energetic: "🔋",
          "High Energy": "⚡",
          default: "🎶",
        },
      },
    };
  }

  /**
   * Initialize the playlist generator
   */
  async initialize() {
    try {
      console.log(chalk.blue("🎵 Initializing playlist generator..."));

      // Initialize database
      const dbInitialized = await this.db.initialize();
      if (!dbInitialized) {
        throw new Error("Database initialization failed");
      }

      // Initialize Spotify API
      const authenticated = await this.auth.authenticate();
      if (!authenticated) {
        throw new Error("Spotify authentication failed");
      }

      this.spotifyApi = this.auth.getSpotifyApi();

      // Get user profile for playlist creation
      const profile = await this.spotifyApi.getMe();
      this.userId = profile.body.id;

      console.log(
        chalk.green(
          `✅ Connected as: ${profile.body.display_name || this.userId}`
        )
      );
      return true;
    } catch (error) {
      ErrorHandler.handleGenericError(
        error,
        "Playlist Generator Initialization"
      );
      return false;
    }
  }

  /**
   * Generate playlists from analysis results
   */
  async generatePlaylists(analysisResults, options = {}) {
    const { dryRun = false, confirm = false, maxPlaylists = 50 } = options;

    try {
      console.log(chalk.cyan("\n🎵 Spotify Playlist Generator"));
      console.log(chalk.gray("Creating playlists from your music analysis\n"));

      if (dryRun) {
        console.log(
          chalk.yellow(
            "🔍 DRY RUN MODE - No actual playlists will be created\n"
          )
        );
      }

      this.stats.startTime = Date.now();

      // Calculate total operations for progress tracking
      const totalGroups = [
        ...analysisResults.genres,
        ...analysisResults.decades,
        ...analysisResults.bpmBands,
        ...analysisResults.energyQuartiles,
      ];

      this.stats.totalOperations = Math.min(totalGroups.length, maxPlaylists);

      if (this.stats.totalOperations === 0) {
        console.log(
          chalk.yellow(
            "⚠️ No groups found in analysis results. Run 'analyze' command first."
          )
        );
        return { success: false, reason: "No analysis results" };
      }

      console.log(
        chalk.white(
          `📊 Planning to create ${this.stats.totalOperations} playlists`
        )
      );

      // Show preview
      this.displayPlaylistPreview(totalGroups.slice(0, maxPlaylists));

      // Confirm creation (if not in confirm mode)
      if (!confirm && !dryRun) {
        const shouldProceed = await this.askConfirmation();
        if (!shouldProceed) {
          console.log(chalk.yellow("❌ Playlist generation cancelled by user"));
          return { success: false, reason: "User cancelled" };
        }
      }

      // Initialize progress bar
      this.initializeProgressBar();

      // Process each category
      const results = {
        genres: await this.processCategory(
          "genre",
          analysisResults.genres,
          dryRun
        ),
        decades: await this.processCategory(
          "decade",
          analysisResults.decades,
          dryRun
        ),
        bpmBands: await this.processCategory(
          "bpm",
          analysisResults.bpmBands,
          dryRun
        ),
        energyQuartiles: await this.processCategory(
          "energy",
          analysisResults.energyQuartiles,
          dryRun
        ),
      };

      // Finalize progress bar
      if (this.progressBar) {
        this.progressBar.stop();
      }

      // Display results
      this.displayResults(dryRun);

      return {
        success: true,
        stats: this.stats,
        results,
      };
    } catch (error) {
      if (this.progressBar) {
        this.progressBar.stop();
      }
      ErrorHandler.handleGenericError(error, "Playlist Generation");
      throw error;
    }
  }

  /**
   * Process a category of analysis results
   */
  async processCategory(categoryType, groups, dryRun) {
    const results = [];

    for (const group of groups) {
      try {
        const result = await this.createPlaylistForGroup(
          categoryType,
          group,
          dryRun
        );
        results.push(result);

        // Update progress
        if (this.progressBar) {
          this.progressBar.increment();
        }
      } catch (error) {
        this.stats.errors.push({
          group: group.label,
          error: error.message,
        });
        console.log(
          chalk.red(
            `⚠️ Error creating playlist for ${group.label}: ${error.message}`
          )
        );
      }
    }

    return results;
  }

  /**
   * Create a playlist for a specific group
   */
  async createPlaylistForGroup(categoryType, group, dryRun) {
    // Generate playlist key and name
    const playlistKey = this.generatePlaylistKey(categoryType, group);
    const playlistName = this.generatePlaylistName(categoryType, group);

    if (dryRun) {
      return {
        key: playlistKey,
        name: playlistName,
        trackCount: group.trackCount,
        category: categoryType,
        dryRun: true,
      };
    }

    // Check if playlist already exists
    const existingPlaylist = await this.findExistingPlaylist(playlistKey);
    let playlistId;

    if (existingPlaylist) {
      playlistId = existingPlaylist.spotifyId;
      this.stats.playlistsUpdated++;
    } else {
      // Create new playlist
      playlistId = await this.createSpotifyPlaylist(playlistName, group);
      this.stats.playlistsCreated++;

      // Store in database
      await this.storePlaylistMapping(
        playlistKey,
        playlistId,
        playlistName,
        categoryType,
        group
      );
    }

    // Add tracks to playlist
    await this.addTracksToPlaylist(playlistId, group.trackIds);
    this.stats.tracksAdded += group.trackIds.length;

    return {
      key: playlistKey,
      name: playlistName,
      spotifyId: playlistId,
      trackCount: group.trackCount,
      category: categoryType,
      success: true,
    };
  }

  /**
   * Generate deterministic playlist key
   */
  generatePlaylistKey(categoryType, group) {
    const baseString = `${categoryType}-${group.label
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")}`;
    const hash = crypto
      .createHash("sha256")
      .update(baseString)
      .digest("hex")
      .substring(0, 8);

    return `${baseString}-${hash}`;
  }

  /**
   * Generate playlist name using templates
   */
  generatePlaylistName(categoryType, group) {
    const template = this.templates[categoryType];
    if (!template) {
      return `🎵 ${group.label}`;
    }

    // Find appropriate emoji
    const labelLower = group.label.toLowerCase();
    let selectedEmoji = template.emojis.default;

    for (const [key, emojiCode] of Object.entries(template.emojis)) {
      if (key !== "default" && labelLower.includes(key.toLowerCase())) {
        selectedEmoji = emojiCode;
        break;
      }
    }

    // Replace template variables
    let name = template.template
      .replace("{emoji}", selectedEmoji)
      .replace("{genre}", group.label)
      .replace("{decade}", group.label)
      .replace("{bpmRange}", group.label)
      .replace("{energyLevel}", group.label);

    // Ensure name is within Spotify's limits (max 100 chars)
    if (name.length > 100) {
      name = name.substring(0, 97) + "...";
    }

    return name;
  }

  /**
   * Create Spotify playlist with rate limiting
   */
  async createSpotifyPlaylist(name, group) {
    const description = this.generatePlaylistDescription(group);

    return await this.rateLimitedRequest(async () => {
      const response = await this.spotifyApi.createPlaylist(this.userId, {
        name,
        description,
        public: false, // Keep playlists private by default
      });

      return response.body.id;
    });
  }

  /**
   * Generate playlist description
   */
  generatePlaylistDescription(group) {
    const baseDesc = `Auto-generated playlist with ${group.trackCount} tracks`;
    const date = new Date().toLocaleDateString();

    if (group.avgBPM) {
      return `${baseDesc} • Avg BPM: ${group.avgBPM} • Created ${date}`;
    }

    if (group.avgEnergy) {
      return `${baseDesc} • Avg Energy: ${group.avgEnergy}% • Created ${date}`;
    }

    return `${baseDesc} • Created ${date}`;
  }

  /**
   * Add tracks to playlist in batches with rate limiting
   */
  async addTracksToPlaylist(playlistId, trackIds) {
    const batchSize = 20; // Spotify's max tracks per request
    const batches = [];

    for (let i = 0; i < trackIds.length; i += batchSize) {
      batches.push(trackIds.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const spotifyUris = batch.map((id) => `spotify:track:${id}`);

      await this.rateLimitedRequest(async () => {
        await this.spotifyApi.addTracksToPlaylist(playlistId, spotifyUris);
      });
    }
  }

  /**
   * Rate limited request execution
   */
  async rateLimitedRequest(requestFn) {
    return new Promise((resolve, reject) => {
      this.rateLimit.requestQueue.push({ requestFn, resolve, reject });
      this.processRequestQueue();
    });
  }

  /**
   * Process request queue with rate limiting
   */
  async processRequestQueue() {
    if (
      this.rateLimit.isProcessing ||
      this.rateLimit.requestQueue.length === 0
    ) {
      return;
    }

    this.rateLimit.isProcessing = true;

    while (this.rateLimit.requestQueue.length > 0) {
      const { requestFn, resolve, reject } =
        this.rateLimit.requestQueue.shift();

      try {
        // Enforce rate limit
        const timeSinceLastRequest =
          Date.now() - this.rateLimit.lastRequestTime;
        const minInterval = 1000 / this.rateLimit.requestsPerSecond;

        if (timeSinceLastRequest < minInterval) {
          await new Promise((resolve) =>
            setTimeout(resolve, minInterval - timeSinceLastRequest)
          );
        }

        const result = await requestFn();
        this.rateLimit.lastRequestTime = Date.now();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }

    this.rateLimit.isProcessing = false;
  }

  /**
   * Store playlist mapping in database
   */
  async storePlaylistMapping(key, spotifyId, name, category, group) {
    try {
      await this.db.storeGeneratedPlaylist({
        key,
        spotifyId,
        name,
        category,
        trackCount: group.trackCount,
        groupData: JSON.stringify(group),
      });
    } catch (error) {
      console.log(
        chalk.yellow(`⚠️ Failed to store playlist mapping: ${error.message}`)
      );
    }
  }

  /**
   * Find existing playlist by key
   */
  async findExistingPlaylist(key) {
    try {
      return await this.db.findPlaylistByKey(key);
    } catch (error) {
      return null;
    }
  }

  /**
   * Initialize progress bar
   */
  initializeProgressBar() {
    this.progressBar = new cliProgress.SingleBar({
      format:
        "Creating Playlists |{bar}| {percentage}% | {value}/{total} | {eta_formatted} remaining",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
    });

    this.progressBar.start(this.stats.totalOperations, 0);
  }

  /**
   * Display playlist preview
   */
  displayPlaylistPreview(groups) {
    console.log(chalk.blue("\n📋 Playlist Preview"));
    console.log(chalk.gray("-".repeat(50)));

    groups.slice(0, 10).forEach((group, index) => {
      const categoryType = this.detectCategoryType(group);
      const name = this.generatePlaylistName(categoryType, group);
      console.log(
        chalk.white(
          `${(index + 1).toString().padStart(2)}. ${name} (${
            group.trackCount
          } tracks)`
        )
      );
    });

    if (groups.length > 10) {
      console.log(chalk.gray(`... and ${groups.length - 10} more playlists`));
    }
  }

  /**
   * Detect category type from group structure
   */
  detectCategoryType(group) {
    if (group.genre) return "genre";
    if (group.decade) return "decade";
    if (group.bpmRange) return "bpm";
    if (group.energyRange) return "energy";
    return "genre"; // default
  }

  /**
   * Ask user confirmation
   */
  async askConfirmation() {
    // Simple implementation - in real app you'd use inquirer or similar
    console.log(
      chalk.yellow(
        "\nProceed with playlist creation? (This will create playlists in your Spotify account)"
      )
    );
    console.log(chalk.gray("Press Ctrl+C to cancel, or continue..."));

    // For CLI demo, we'll return true. In real implementation, add proper prompting
    return true;
  }

  /**
   * Display generation results
   */
  displayResults(dryRun) {
    const duration = (Date.now() - this.stats.startTime) / 1000;

    console.log(
      chalk.green(
        `\n✅ ${
          dryRun ? "Dry run" : "Playlist generation"
        } completed in ${duration.toFixed(1)}s`
      )
    );
    console.log(chalk.white("\n📊 Generation Statistics:"));

    if (dryRun) {
      console.log(
        chalk.cyan(`   Playlists planned: ${this.stats.totalOperations}`)
      );
    } else {
      console.log(
        chalk.cyan(`   Playlists created: ${this.stats.playlistsCreated}`)
      );
      console.log(
        chalk.cyan(`   Playlists updated: ${this.stats.playlistsUpdated}`)
      );
      console.log(chalk.cyan(`   Tracks added: ${this.stats.tracksAdded}`));
    }

    if (this.stats.errors.length > 0) {
      console.log(chalk.red(`   Errors: ${this.stats.errors.length}`));
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.db) {
      await this.db.disconnect();
    }
  }
}

module.exports = PlaylistGenerator;
