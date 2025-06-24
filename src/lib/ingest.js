/**
 * Spotify Data Ingest Module
 *
 * Handles fetching and caching all liked songs from user's Spotify account
 * with efficient pagination, progress tracking, and error handling
 */

const chalk = require("chalk");
const cliProgress = require("cli-progress");
const SpotifyAuth = require("./auth");
const DatabaseService = require("./database");
const ErrorHandler = require("../utils/errorHandler");
const RetryHandler = require("../utils/retryHandler");

class SpotifyIngest {
  constructor() {
    this.auth = new SpotifyAuth();
    this.db = new DatabaseService();
    this.spotifyApi = null;

    // Pagination configuration
    this.config = {
      batchSize: 50, // Maximum allowed by Spotify API
      maxRetries: 3,
      retryDelay: 1000,
    };

    // Progress tracking
    this.progressBar = null;
    this.stats = {
      totalTracks: 0,
      fetchedTracks: 0,
      fetchedGenres: 0,
      fetchedAudioFeatures: 0,
      startTime: null,
      endTime: null,
    };

    // Current scan record ID for database tracking
    this.currentScanId = null;
    this.spotifyUserId = null;
  }

  /**
   * Initialize the ingest module and authenticate
   */
  async initialize() {
    try {
      console.log(chalk.blue("🎵 Initializing Spotify data ingest..."));

      // Initialize database first
      const dbInitialized = await this.db.initialize();
      if (!dbInitialized) {
        throw new Error("Database initialization failed");
      }

      // Load existing tokens or authenticate
      const tokens = await this.auth.loadStoredTokens();

      if (!tokens) {
        console.log(
          chalk.yellow("⚠️  No valid tokens found. Please authenticate first.")
        );
        console.log(chalk.white("Run: spotify-organizer auth"));
        return false;
      }

      this.spotifyApi = this.auth.getSpotifyApi();

      // Test API connection and get user info
      const userInfo = await this.spotifyApi.getMe();
      this.spotifyUserId = userInfo.body.id;

      console.log(chalk.green("✅ Spotify API connection established"));
      console.log(
        chalk.white(
          `👤 Connected as: ${userInfo.body.display_name || userInfo.body.id}`
        )
      );

      return true;
    } catch (error) {
      ErrorHandler.handleAuthError(error, "Ingest Initialization");
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.db) {
      await this.db.disconnect();
    }
  }

  /**
   * Fetch all liked songs with robust pagination and caching
   */
  async fetchAllLikedSongs(options = {}) {
    const { extendedMode = false, onProgress = null } = options;

    try {
      this.stats.startTime = Date.now();
      console.log(chalk.blue("🔍 Starting liked songs scan..."));

      // Initialize pagination
      const paginationState = this.initializePagination();
      const allTracks = [];

      // First request to get total count
      const firstBatch = await this.fetchTracksPage(paginationState);

      if (!firstBatch.success) {
        throw new Error(`Failed to fetch first batch: ${firstBatch.error}`);
      }

      // Initialize progress tracking and database scan record
      this.stats.totalTracks = firstBatch.data.total;
      this.initializeProgressBar();

      const scanType = extendedMode ? "extended" : "full";
      this.currentScanId = await this.db.createScanRecord(
        scanType,
        this.stats.totalTracks,
        this.spotifyUserId
      );

      console.log(
        chalk.white(`📊 Found ${this.stats.totalTracks} liked songs`)
      );

      // Process first batch
      allTracks.push(...firstBatch.data.items);
      await this.cacheTracksBatch(firstBatch.data.items);
      this.updateProgress(firstBatch.data.items.length);

      // Continue pagination
      let currentBatch = firstBatch;
      while (currentBatch.data.next && paginationState.hasNext) {
        paginationState.offset += paginationState.limit;
        paginationState.currentPage++;

        const batch = await this.fetchTracksPage(paginationState);

        if (batch.success) {
          allTracks.push(...batch.data.items);

          // Cache each batch immediately
          await this.cacheTracksBatch(batch.data.items);

          this.updateProgress(batch.data.items.length);

          // Update pagination state
          paginationState.hasNext = !!batch.data.next;
          currentBatch = batch;

          // Update database scan progress
          if (this.currentScanId) {
            await this.db.updateScanProgress(this.currentScanId, {
              tracksProcessed: allTracks.length,
            });
          }

          // Optional progress callback
          if (onProgress) {
            onProgress({
              fetched: allTracks.length,
              total: this.stats.totalTracks,
              percentage: (allTracks.length / this.stats.totalTracks) * 100,
            });
          }
        } else {
          console.log(chalk.yellow(`⚠️  Batch failed, retrying...`));
        }
      }

      this.finalizeScan();

      console.log(
        chalk.green(`✅ Scan complete! Fetched ${allTracks.length} tracks`)
      );

      // If extended mode, fetch additional data
      let extendedData = {};
      if (extendedMode) {
        extendedData = await this.fetchExtendedData(allTracks);
      }

      // Complete scan record
      if (this.currentScanId) {
        await this.db.completeScan(this.currentScanId, "completed");
      }

      return {
        success: true,
        tracks: allTracks,
        extendedData,
        stats: this.stats,
        scanId: this.currentScanId,
      };
    } catch (error) {
      this.finalizeScan();

      // Mark scan as failed
      if (this.currentScanId) {
        await this.db.completeScan(this.currentScanId, "failed", error.message);
      }

      ErrorHandler.handleNetworkError(error, "Liked Songs Fetch");
      return {
        success: false,
        error: error.message,
        tracks: [],
      };
    }
  }

  /**
   * Cache a batch of tracks to the database
   */
  async cacheTracksBatch(trackItems) {
    try {
      const cacheStats = await this.db.storeTracks(
        trackItems,
        this.currentScanId
      );

      // Update our local stats
      this.stats.tracksAdded =
        (this.stats.tracksAdded || 0) + cacheStats.tracksAdded;
      this.stats.tracksUpdated =
        (this.stats.tracksUpdated || 0) + cacheStats.tracksUpdated;

      return cacheStats;
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Error caching batch: ${error.message}`));
      return { tracksAdded: 0, tracksUpdated: 0 };
    }
  }

  /**
   * Initialize pagination state
   */
  initializePagination() {
    return {
      offset: 0,
      limit: this.config.batchSize,
      hasNext: true,
      currentPage: 1,
    };
  }

  /**
   * Fetch a single page of tracks with retry logic
   */
  async fetchTracksPage(paginationState) {
    const { offset, limit } = paginationState;

    try {
      const response = await RetryHandler.retryNetworkOperation(async () => {
        return await this.spotifyApi.getMySavedTracks({
          limit,
          offset,
          market: "from_token", // Use user's country
        });
      }, `Tracks Page ${paginationState.currentPage}`);

      return {
        success: true,
        data: {
          items: response.body.items,
          total: response.body.total,
          next: response.body.next,
          offset: response.body.offset,
          limit: response.body.limit,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  /**
   * Fetch extended data (genres and audio features)
   */
  async fetchExtendedData(tracks) {
    console.log(
      chalk.blue("\n🎛️  Fetching extended data (genres & audio features)...")
    );

    try {
      // Extract unique track and artist IDs
      const trackIds = tracks.map((item) => item.track?.id).filter((id) => id);

      const artistIds = Array.from(
        new Set(
          tracks
            .flatMap((item) => item.track?.artists || [])
            .map((artist) => artist.id)
            .filter((id) => id)
        )
      );

      console.log(
        chalk.white(`🎤 Fetching genres for ${artistIds.length} artists...`)
      );
      console.log(
        chalk.white(
          `🎵 Fetching audio features for ${trackIds.length} tracks...`
        )
      );

      // Fetch in parallel for better performance
      const [genres, audioFeatures] = await Promise.all([
        this.fetchArtistGenres(artistIds),
        this.fetchAudioFeatures(trackIds),
      ]);

      // Cache extended data
      if (Object.keys(genres).length > 0) {
        await this.db.storeArtistGenres(genres);
      }

      if (Object.keys(audioFeatures).length > 0) {
        await this.db.storeAudioFeatures(audioFeatures);
      }

      // Update scan stats
      if (this.currentScanId) {
        await this.db.updateScanProgress(this.currentScanId, {
          genresFetched: Object.keys(genres).length,
          audioFeaturesFetched: Object.keys(audioFeatures).length,
        });
      }

      return {
        genres,
        audioFeatures,
      };
    } catch (error) {
      ErrorHandler.handleNetworkError(error, "Extended Data Fetch");
      return {
        genres: {},
        audioFeatures: {},
      };
    }
  }

  /**
   * Fetch artist genres in batches
   */
  async fetchArtistGenres(artistIds) {
    const genres = {};
    const batchSize = 50; // Spotify API limit for artists endpoint

    for (let i = 0; i < artistIds.length; i += batchSize) {
      const batch = artistIds.slice(i, i + batchSize);

      try {
        const response = await RetryHandler.retryNetworkOperation(async () => {
          return await this.spotifyApi.getArtists(batch);
        }, `Artist Genres Batch ${Math.floor(i / batchSize) + 1}`);

        response.body.artists.forEach((artist) => {
          if (artist) {
            genres[artist.id] = artist.genres || [];
          }
        });

        this.stats.fetchedGenres += batch.length;
      } catch (error) {
        console.log(
          chalk.yellow(`⚠️  Failed to fetch genres for batch starting at ${i}`)
        );
      }
    }

    return genres;
  }

  /**
   * Fetch audio features in batches
   */
  async fetchAudioFeatures(trackIds) {
    const audioFeatures = {};
    const batchSize = 100; // Spotify API limit for audio features endpoint

    for (let i = 0; i < trackIds.length; i += batchSize) {
      const batch = trackIds.slice(i, i + batchSize);

      try {
        const response = await RetryHandler.retryNetworkOperation(async () => {
          return await this.spotifyApi.getAudioFeaturesForTracks(batch);
        }, `Audio Features Batch ${Math.floor(i / batchSize) + 1}`);

        response.body.audio_features.forEach((features) => {
          if (features) {
            audioFeatures[features.id] = features;
          }
        });

        this.stats.fetchedAudioFeatures += batch.length;
      } catch (error) {
        console.log(
          chalk.yellow(
            `⚠️  Failed to fetch audio features for batch starting at ${i}`
          )
        );
      }
    }

    return audioFeatures;
  }

  // =====================================
  // Progress Tracking Methods
  // =====================================

  /**
   * Initialize the progress bar
   */
  initializeProgressBar() {
    this.progressBar = new cliProgress.SingleBar(
      {
        format:
          chalk.cyan("Progress") +
          " |{bar}| {percentage}% | {value}/{total} tracks | ETA: {eta}s",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    );

    this.progressBar.start(this.stats.totalTracks, 0);
  }

  /**
   * Update progress bar
   */
  updateProgress(batchSize) {
    this.stats.fetchedTracks += batchSize;

    if (this.progressBar) {
      this.progressBar.update(this.stats.fetchedTracks);
    }
  }

  /**
   * Finalize the scan and clean up progress bar
   */
  finalizeScan() {
    if (this.progressBar) {
      this.progressBar.stop();
      this.progressBar = null;
    }

    this.stats.endTime = Date.now();

    if (this.stats.startTime) {
      const duration = (this.stats.endTime - this.stats.startTime) / 1000;
      console.log(
        chalk.gray(`⏱️  Scan completed in ${duration.toFixed(1)} seconds`)
      );
    }
  }

  /**
   * Get pagination metadata for debugging/monitoring
   */
  getPaginationMetadata() {
    return {
      batchSize: this.config.batchSize,
      totalTracks: this.stats.totalTracks,
      fetchedTracks: this.stats.fetchedTracks,
      progress:
        this.stats.totalTracks > 0
          ? (this.stats.fetchedTracks / this.stats.totalTracks) * 100
          : 0,
      estimatedBatches: Math.ceil(
        this.stats.totalTracks / this.config.batchSize
      ),
    };
  }

  /**
   * Reset stats for new scan
   */
  resetStats() {
    this.stats = {
      totalTracks: 0,
      fetchedTracks: 0,
      fetchedGenres: 0,
      fetchedAudioFeatures: 0,
      startTime: null,
      endTime: null,
    };
    this.currentScanId = null;
  }

  /**
   * Get cached tracks from database
   */
  async getCachedTracks(includeAudioFeatures = false) {
    try {
      return await this.db.getAllTracks(includeAudioFeatures);
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Cache Retrieval");
      return [];
    }
  }

  /**
   * Get scan history
   */
  async getScanHistory() {
    try {
      return await this.db.getScanHistory();
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Scan History Retrieval");
      return [];
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    try {
      return await this.db.getStats();
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Database Stats");
      return null;
    }
  }
}

module.exports = SpotifyIngest;
