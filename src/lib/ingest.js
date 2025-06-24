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
const CacheManager = require("./cache");
const BatchManager = require("./batchManager");
const ParallelProcessor = require("./parallelProcessor");
const MemoryOptimizer = require("./memoryOptimizer");
const SkipLogicManager = require("./skipLogicManager");
const StreamProcessor = require("./streamProcessor");
const ErrorHandler = require("../utils/errorHandler");
const RetryHandler = require("../utils/retryHandler");

class SpotifyIngest {
  constructor() {
    this.auth = new SpotifyAuth();
    this.db = new DatabaseService();

    // Pagination configuration (API-specific limits) - Define early
    this.config = {
      batchSize: 50, // Spotify saved tracks API limit
      genreBatchSize: 50, // Maximum allowed by Spotify API for artists
      audioFeaturesBatchSize: 100, // Maximum allowed for audio features
      maxRetries: 3,
      retryDelay: 1000,
    };

    this.cache = new CacheManager({
      maxMemoryItems: 5000,
      maxMemorySize: 25 * 1024 * 1024, // 25MB for ingest cache
    });
    this.batchManager = new BatchManager({
      maxConcurrentBatches: 3,
      batchFlushInterval: 50, // Faster flushing for real-time feeling
      adaptiveSizingEnabled: true,
    });
    this.parallelProcessor = new ParallelProcessor({
      maxWorkers: 2, // Conservative for API operations
      maxConcurrentAsync: 8, // Higher concurrency for I/O operations
      chunkSize: 100, // Optimize for API batch sizes
    });
    this.memoryOptimizer = new MemoryOptimizer({
      monitoringInterval: 30000, // 30 seconds during ingest
      memoryWarningThreshold: 400 * 1024 * 1024, // 400MB warning for ingest
      memoryCriticalThreshold: 800 * 1024 * 1024, // 800MB critical for ingest
      enableObjectPooling: true,
    });
    this.skipLogicManager = new SkipLogicManager({
      defaultCacheTTL: 20 * 60 * 1000, // 20 minutes for ingest cache
      metadataCacheTTL: 2 * 60 * 60 * 1000, // 2 hours for metadata
      minBatchSize: 5, // Skip if batch is too small
      incrementalThreshold: 0.05, // 5% change threshold for ingest
      enableDetailedLogging: true,
      enableSkipMetrics: true,
    });
    this.streamProcessor = new StreamProcessor({
      batchSize: this.config.batchSize,
      enableCaching: true,
      enableSkipLogic: true,
      enableParallel: true,
      continueOnError: true,
      cache: this.cache,
      batchManager: this.batchManager,
      parallelProcessor: this.parallelProcessor,
      skipLogicManager: this.skipLogicManager,
      memoryOptimizer: this.memoryOptimizer,
    });
    this.spotifyApi = null;

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
    if (this.streamProcessor) {
      await this.streamProcessor.shutdown();
    }
    if (this.skipLogicManager) {
      this.skipLogicManager.shutdown();
    }
    if (this.memoryOptimizer) {
      await this.memoryOptimizer.shutdown();
    }
    if (this.parallelProcessor) {
      await this.parallelProcessor.shutdown();
    }
    if (this.batchManager) {
      await this.batchManager.shutdown();
    }
    if (this.cache) {
      await this.cache.shutdown();
    }
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

      // Skip logic: Check if we should skip the entire scan operation
      const scanSkipCheck = this.skipLogicManager.shouldSkipOperation(
        "full_scan",
        {
          time: {
            interval: 15 * 60 * 1000, // Skip if scanned within last 15 minutes
            force: options.force || false,
          },
          cache: {
            data: await this.getCachedScanData(),
            ttl: 20 * 60 * 1000, // 20 minutes cache for full scans
          },
        }
      );

      if (scanSkipCheck.skip) {
        console.log(chalk.yellow(`⏭️ Skipping scan: ${scanSkipCheck.reason}`));
        const cachedData = await this.getCachedTracks(extendedMode);
        return {
          success: true,
          tracks: cachedData.tracks || [],
          extendedData: cachedData.extendedData || {},
          stats: this.stats,
          skipped: true,
          skipReason: scanSkipCheck.reason,
        };
      }

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
      // Skip logic: Check if batch should be processed
      const batchSkipCheck = this.skipLogicManager.shouldSkipBatchOperation(
        "track_batch_cache",
        trackItems,
        {
          cacheKey: `batch_${trackItems.length}_${Date.now()}`,
        }
      );

      if (batchSkipCheck.skip) {
        console.log(
          chalk.gray(`⏭️ Skipping batch cache: ${batchSkipCheck.reason}`)
        );
        return { tracksAdded: 0, tracksUpdated: 0, skipped: true };
      }

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
   * Fetch extended data (genres and audio features) with parallel processing
   */
  async fetchExtendedData(tracks) {
    console.log(
      chalk.blue("\n🎛️  Fetching extended data (genres & audio features)...")
    );

    try {
      // Extract unique track and artist IDs with parallel processing for large datasets
      let trackIds, artistIds;

      if (tracks.length > 1000) {
        console.log(
          chalk.blue("📦 Using parallel processing for ID extraction...")
        );

        // Process track extraction in parallel
        const extractionResults = await this.parallelProcessor.processAsync(
          tracks,
          async (trackBatch) => {
            const batchTrackIds = trackBatch.track?.id
              ? [trackBatch.track.id]
              : [];
            const batchArtistIds = trackBatch.track?.artists
              ? trackBatch.track.artists
                  .map((artist) => artist.id)
                  .filter((id) => id)
              : [];

            return {
              trackIds: batchTrackIds,
              artistIds: batchArtistIds,
            };
          },
          { concurrency: 4 }
        );

        // Merge results
        trackIds = extractionResults.flatMap((result) => result.trackIds);
        artistIds = [
          ...new Set(extractionResults.flatMap((result) => result.artistIds)),
        ];
      } else {
        // Use sequential processing for smaller datasets
        trackIds = tracks.map((item) => item.track?.id).filter((id) => id);
        artistIds = Array.from(
          new Set(
            tracks
              .flatMap((item) => item.track?.artists || [])
              .map((artist) => artist.id)
              .filter((id) => id)
          )
        );
      }

      console.log(
        chalk.white(`🎤 Fetching genres for ${artistIds.length} artists...`)
      );
      console.log(
        chalk.white(
          `🎵 Fetching audio features for ${trackIds.length} tracks...`
        )
      );

      // Use mixed processing: parallel API fetching + parallel database operations
      const mixedWorkload = {
        ioTasks: {
          items: [
            { type: "genres", ids: artistIds },
            { type: "audioFeatures", ids: trackIds },
          ],
          processor: async (task) => {
            if (task.type === "genres") {
              return {
                type: "genres",
                data: await this.fetchArtistGenres(task.ids),
              };
            } else {
              return {
                type: "audioFeatures",
                data: await this.fetchAudioFeatures(task.ids),
              };
            }
          },
          options: { concurrency: 2 },
        },
      };

      // Execute parallel workload
      const results = await this.parallelProcessor.processMixed(mixedWorkload);

      // Extract results
      const genres = results.io.find((r) => r.type === "genres")?.data || {};
      const audioFeatures =
        results.io.find((r) => r.type === "audioFeatures")?.data || {};

      // Store extended data in parallel
      const storagePromises = [];

      if (Object.keys(genres).length > 0) {
        storagePromises.push(this.db.storeArtistGenres(genres));
      }

      if (Object.keys(audioFeatures).length > 0) {
        storagePromises.push(this.db.storeAudioFeatures(audioFeatures));
      }

      // Update scan stats in parallel with storage
      if (this.currentScanId) {
        storagePromises.push(
          this.db.updateScanProgress(this.currentScanId, {
            genresFetched: Object.keys(genres).length,
            audioFeaturesFetched: Object.keys(audioFeatures).length,
          })
        );
      }

      // Wait for all storage operations to complete
      await Promise.all(storagePromises);

      console.log(
        chalk.green(
          "✅ Extended data processing completed with parallel optimization"
        )
      );

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
   * Fetch artist genres in batches with caching and intelligent batching
   */
  async fetchArtistGenres(artistIds) {
    const genres = {};
    const uncachedIds = [];

    // Check cache first for each artist
    for (const artistId of artistIds) {
      try {
        const cachedGenres = await this.cache.getArtistGenres(artistId, null);
        if (cachedGenres) {
          genres[artistId] = cachedGenres;
          this.stats.fetchedGenres++;
        } else {
          uncachedIds.push(artistId);
        }
      } catch (error) {
        uncachedIds.push(artistId);
      }
    }

    console.log(
      chalk.gray(
        `📦 Cache: ${Object.keys(genres).length} artists cached, ${
          uncachedIds.length
        } to fetch`
      )
    );

    // Fetch uncached artists using BatchManager
    if (uncachedIds.length > 0) {
      try {
        const batchFetchFunction = async (ids) => {
          const response = await RetryHandler.retryNetworkOperation(
            async () => {
              return await this.spotifyApi.getArtists(ids);
            },
            `Artist Genres Batch`
          );
          return response.body.artists;
        };

        // Use BatchManager for intelligent batching
        const artistResults = await this.batchManager.addBatchRequest(
          "artists",
          uncachedIds,
          batchFetchFunction,
          "normal"
        );

        // Process and cache results
        for (const artist of artistResults) {
          if (artist) {
            const artistGenres = artist.genres || [];
            genres[artist.id] = artistGenres;

            // Cache for future use
            await this.cache.getArtistGenres(
              artist.id,
              async () => artistGenres
            );
            this.stats.fetchedGenres++;
          }
        }

        console.log(
          chalk.blue(
            `📦 BatchManager: Processed ${artistResults.length} artists`
          )
        );
      } catch (error) {
        console.log(
          chalk.yellow(`⚠️  Failed to fetch genres: ${error.message}`)
        );
      }
    }

    return genres;
  }

  /**
   * Fetch audio features in batches with caching and intelligent batching
   */
  async fetchAudioFeatures(trackIds) {
    const audioFeatures = {};

    // Use cache's batch audio features method with BatchManager for optimal performance
    try {
      const results = await this.cache.getAudioFeatures(
        trackIds,
        async (uncachedIds) => {
          console.log(
            chalk.gray(
              `📦 Cache: ${
                trackIds.length - uncachedIds.length
              } features cached, ${uncachedIds.length} to fetch`
            )
          );

          // Use BatchManager for intelligent batching
          const batchFetchFunction = async (ids) => {
            const response = await RetryHandler.retryNetworkOperation(
              async () => {
                return await this.spotifyApi.getAudioFeaturesForTracks(ids);
              },
              `Audio Features Batch`
            );

            // Filter out null features
            return response.body.audio_features.filter((f) => f !== null);
          };

          // Process through BatchManager for optimal batching
          const batchResults = await this.batchManager.addBatchRequest(
            "audioFeatures",
            uncachedIds,
            batchFetchFunction,
            "normal"
          );

          // Flatten results since BatchManager returns array of arrays
          const validFeatures = batchResults.flat();
          this.stats.fetchedAudioFeatures += validFeatures.length;

          console.log(
            chalk.blue(
              `📦 BatchManager: Processed ${validFeatures.length} audio features`
            )
          );

          return validFeatures;
        }
      );

      // Convert results to the expected format
      for (const result of results) {
        if (result.features) {
          audioFeatures[result.id] = result.features;
        }
      }
    } catch (error) {
      console.log(
        chalk.yellow(
          `⚠️  Error in cached audio features fetch: ${error.message}`
        )
      );
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

  /**
   * Get cached scan data for skip logic
   */
  async getCachedScanData() {
    try {
      const stats = await this.db.getStats();
      const lastScan = await this.getScanHistory();

      if (lastScan && lastScan.length > 0) {
        const recentScan = lastScan[0];
        return {
          timestamp: new Date(recentScan.endTime).getTime(),
          value: {
            trackCount: stats.tracks,
            scanType: recentScan.scanType,
            status: recentScan.status,
          },
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get skip logic metrics
   */
  getSkipMetrics() {
    return this.skipLogicManager.getMetrics();
  }

  /**
   * Fetch all liked songs using streaming approach for large datasets
   */
  async fetchAllLikedSongsStreaming(options = {}) {
    const {
      extendedMode = false,
      onProgress = null,
      streamBatchSize = 200,
    } = options;

    try {
      console.log(chalk.blue("🌊 Starting streaming liked songs ingestion..."));
      this.stats.startTime = Date.now();

      // Get total count first
      const firstBatch = await this.fetchTracksPage(
        this.initializePagination()
      );
      if (!firstBatch.success) {
        throw new Error(`Failed to fetch first batch: ${firstBatch.error}`);
      }

      this.stats.totalTracks = firstBatch.data.total;
      console.log(
        chalk.white(`📊 Streaming ${this.stats.totalTracks} liked songs`)
      );

      // Create scan record
      this.currentScanId = await this.db.createScanRecord(
        extendedMode ? "extended_streaming" : "streaming",
        this.stats.totalTracks,
        this.spotifyUserId
      );

      // Start streaming metrics monitoring
      this.streamProcessor.startMetricsMonitoring();

      // Create streaming pipeline for data ingestion
      const result = await this.streamProcessor.createPipeline(
        // Source: Generator function for paginated API calls
        async function* () {
          const pagination = {
            offset: 0,
            limit: 50,
            hasNext: true,
            currentPage: 1,
          };

          while (pagination.hasNext) {
            try {
              const response = await this.spotifyApi.getMySavedTracks({
                limit: pagination.limit,
                offset: pagination.offset,
                market: "from_token",
              });

              const items = response.body.items;
              if (items && items.length > 0) {
                yield items;
                pagination.offset += pagination.limit;
                pagination.hasNext = !!response.body.next;
              } else {
                pagination.hasNext = false;
              }
            } catch (error) {
              console.log(
                chalk.yellow(
                  `⚠️  API error at offset ${pagination.offset}: ${error.message}`
                )
              );
              pagination.hasNext = false;
            }
          }
        }.bind(this),

        // Processors: Transform and batch the data
        [
          // Flatten the batched items
          (trackBatch) => trackBatch.flat(),

          // Batch processor for efficient database storage
          {
            type: "batch",
            batchSize: streamBatchSize,
            handler: async (tracks) => {
              try {
                // Cache tracks to database in batches
                const cacheStats = await this.db.storeTracks(
                  tracks,
                  this.currentScanId
                );

                // Update stats
                this.stats.tracksAdded =
                  (this.stats.tracksAdded || 0) + cacheStats.tracksAdded;
                this.stats.tracksUpdated =
                  (this.stats.tracksUpdated || 0) + cacheStats.tracksUpdated;

                // Progress callback
                if (onProgress) {
                  onProgress({
                    fetched: this.stats.tracksAdded + this.stats.tracksUpdated,
                    total: this.stats.totalTracks,
                    percentage:
                      ((this.stats.tracksAdded + this.stats.tracksUpdated) /
                        this.stats.totalTracks) *
                      100,
                  });
                }

                return cacheStats;
              } catch (error) {
                console.log(
                  chalk.yellow(`⚠️  Batch storage error: ${error.message}`)
                );
                return { tracksAdded: 0, tracksUpdated: 0 };
              }
            },
          },
        ],

        // Destination: Aggregate results
        async (batchResult) => {
          console.log(
            chalk.gray(
              `📦 Processed batch: +${batchResult.tracksAdded} new, ~${batchResult.tracksUpdated} updated`
            )
          );
        },

        // Options
        {
          source: { maxPages: Math.ceil(this.stats.totalTracks / 50) },
          batch: { batchSize: streamBatchSize },
          processing: { enableCaching: true },
        }
      );

      // Stop metrics monitoring
      this.streamProcessor.stopMetricsMonitoring();

      if (result.success) {
        console.log(
          chalk.green(`✅ Streaming ingestion completed successfully`)
        );

        // Handle extended mode if requested
        let extendedData = {};
        if (extendedMode) {
          console.log(
            chalk.blue("🔗 Fetching extended data for streamed tracks...")
          );
          const allTracks = await this.db.getAllTracks(false);
          extendedData = await this.fetchExtendedData(allTracks);
        }

        // Complete scan record
        if (this.currentScanId) {
          await this.db.completeScan(this.currentScanId, "completed");
        }

        this.finalizeScan();

        return {
          success: true,
          tracks: [], // Tracks are already stored in database
          extendedData,
          stats: this.stats,
          streamMetrics: this.streamProcessor.getOverallMetrics(),
          scanId: this.currentScanId,
          streaming: true,
        };
      } else {
        throw new Error(`Streaming pipeline failed: ${result.error}`);
      }
    } catch (error) {
      this.finalizeScan();

      // Mark scan as failed
      if (this.currentScanId) {
        await this.db.completeScan(this.currentScanId, "failed", error.message);
      }

      ErrorHandler.handleNetworkError(error, "Streaming Liked Songs Fetch");
      return {
        success: false,
        error: error.message,
        tracks: [],
        streaming: true,
      };
    }
  }

  /**
   * Get streaming processor metrics
   */
  getStreamMetrics() {
    return this.streamProcessor.getOverallMetrics();
  }
}

module.exports = SpotifyIngest;
