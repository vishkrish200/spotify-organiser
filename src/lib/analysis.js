/**
 * Music Analysis Module
 *
 * Implements label discovery algorithm to analyze track metadata and audio features
 * for automatic playlist categorization and grouping
 */

const chalk = require("chalk");
const DatabaseService = require("./database");
const CacheManager = require("./cache");
const ParallelProcessor = require("./parallelProcessor");
const MemoryOptimizer = require("./memoryOptimizer");
const SkipLogicManager = require("./skipLogicManager");
const StreamProcessor = require("./streamProcessor");
const ErrorHandler = require("../utils/errorHandler");

class MusicAnalysis {
  constructor() {
    this.db = new DatabaseService();
    this.cache = new CacheManager({
      maxMemoryItems: 1000,
      maxMemorySize: 10 * 1024 * 1024, // 10MB for analysis cache
      analysisResultsTTL: 30 * 60 * 1000, // 30 minutes cache for analysis
    });
    this.parallelProcessor = new ParallelProcessor({
      maxWorkers: 2, // Conservative for analysis tasks
      maxConcurrentAsync: 6, // Allow concurrent DB operations
      chunkSize: 200, // Process tracks in chunks of 200
    });
    this.memoryOptimizer = new MemoryOptimizer({
      monitoringInterval: 45000, // 45 seconds during analysis
      memoryWarningThreshold: 250 * 1024 * 1024, // 250MB warning for analysis
      memoryCriticalThreshold: 500 * 1024 * 1024, // 500MB critical for analysis
      enableObjectPooling: true,
    });
    this.skipLogicManager = new SkipLogicManager({
      analysisCacheTTL: 45 * 60 * 1000, // 45 minutes for analysis cache
      defaultCacheTTL: 30 * 60 * 1000, // 30 minutes for component cache
      minBatchSize: 10, // Minimum tracks for meaningful analysis
      incrementalThreshold: 0.15, // 15% change threshold for re-analysis
      enableDetailedLogging: true,
      enableSkipMetrics: true,
    });
    this.streamProcessor = new StreamProcessor({
      batchSize: 200, // Larger batches for analysis
      enableCaching: true,
      enableSkipLogic: true,
      enableParallel: true,
      continueOnError: true,
      cache: this.cache,
      parallelProcessor: this.parallelProcessor,
      skipLogicManager: this.skipLogicManager,
      memoryOptimizer: this.memoryOptimizer,
    });

    // Analysis configuration
    this.config = {
      minTracksPerLabel: 15, // Minimum tracks to create a meaningful group
      maxLabels: 20, // Maximum number of labels to generate per category
      excludedGenres: ["viral", "deep", "new", "old", "modern", "classic"], // Generic genres to exclude

      // BPM ranges for dance/energy categorization
      bpmRanges: [
        { name: "Slow & Chill", min: 60, max: 90 },
        { name: "Mid-Tempo", min: 90, max: 120 },
        { name: "Upbeat", min: 120, max: 140 },
        { name: "High Energy", min: 140, max: 180 },
        { name: "Electronic/Dance", min: 180, max: 200 },
      ],

      // Energy quartiles for mood categorization
      energyQuartiles: [
        { name: "Mellow", min: 0.0, max: 0.25 },
        { name: "Relaxed", min: 0.25, max: 0.5 },
        { name: "Energetic", min: 0.5, max: 0.75 },
        { name: "High Energy", min: 0.75, max: 1.0 },
      ],
    };

    // Results storage
    this.analysisResults = {
      genres: [],
      decades: [],
      bpmBands: [],
      energyQuartiles: [],
      totalTracks: 0,
      analysisDate: null,
    };
  }

  /**
   * Initialize the analysis module
   */
  async initialize() {
    try {
      console.log(chalk.blue("🔍 Initializing music analysis..."));

      const dbInitialized = await this.db.initialize();
      if (!dbInitialized) {
        throw new Error("Database initialization failed");
      }

      return true;
    } catch (error) {
      ErrorHandler.handleGenericError(error, "Analysis Initialization");
      return false;
    }
  }

  /**
   * Run complete analysis on the music library with caching
   */
  async analyzeLibrary(options = {}) {
    const { minTracks = this.config.minTracksPerLabel } = options;

    try {
      console.log(chalk.cyan("🎵 Starting music library analysis..."));
      console.log(
        chalk.gray("Discovering patterns in genres, decades, tempo, and energy")
      );

      const startTime = Date.now();

      // Create cache key based on analysis parameters and database state
      const stats = await this.db.getStats();
      const cacheKey = `library_analysis_${stats.tracks}_${minTracks}`;

      // Skip logic: Check if we should skip the entire analysis operation
      const analysisSkipCheck = this.skipLogicManager.shouldSkipOperation(
        "library_analysis",
        {
          cache: {
            data: await this.getCachedAnalysisData(cacheKey),
            ttl: this.skipLogicManager.config.analysisCacheTTL,
          },
          time: {
            interval: 30 * 60 * 1000, // Skip if analyzed within last 30 minutes
            force: options.force || false,
          },
          batch: {
            data: [{ trackCount: stats.tracks, minTracks }],
            options: { minSize: 1 },
          },
        }
      );

      if (analysisSkipCheck.skip) {
        console.log(
          chalk.yellow(`⏭️ Skipping analysis: ${analysisSkipCheck.reason}`)
        );
        if (analysisSkipCheck.data) {
          this.analysisResults = analysisSkipCheck.data;
          return analysisSkipCheck.data;
        }
      }

      // Check for cached analysis results
      const cachedResults = await this.cache.getCachedAnalysisResults(cacheKey);
      if (cachedResults) {
        console.log(chalk.green("📦 Using cached analysis results"));
        console.log(
          chalk.gray(
            `✅ Analysis retrieved from cache in ${(
              (Date.now() - startTime) /
              1000
            ).toFixed(1)} seconds`
          )
        );

        // Update local results
        this.analysisResults = cachedResults;
        return cachedResults;
      }

      // Get all tracks with metadata
      const tracks = await this.getAllTracksWithMetadata();

      if (!tracks || tracks.length === 0) {
        throw new Error(
          "No tracks found in database. Run 'scan' command first."
        );
      }

      console.log(chalk.white(`📊 Analyzing ${tracks.length} tracks...`));
      this.analysisResults.totalTracks = tracks.length;

      // Run all analyses in parallel for better performance
      const [genres, decades, bpmBands, energyQuartiles] = await Promise.all([
        this.analyzeGenres(tracks, minTracks),
        this.analyzeDecades(tracks, minTracks),
        this.analyzeBPMBands(tracks, minTracks),
        this.analyzeEnergyQuartiles(tracks, minTracks),
      ]);

      // Store results
      this.analysisResults = {
        genres,
        decades,
        bpmBands,
        energyQuartiles,
        totalTracks: tracks.length,
        analysisDate: new Date().toISOString(),
      };

      const duration = (Date.now() - startTime) / 1000;
      console.log(
        chalk.green(`✅ Analysis completed in ${duration.toFixed(1)} seconds`)
      );

      // Cache the results for future use
      await this.cache.cacheAnalysisResults(cacheKey, this.analysisResults);

      return this.analysisResults;
    } catch (error) {
      ErrorHandler.handleGenericError(error, "Library Analysis");
      throw error;
    }
  }

  /**
   * Analyze genre distribution and find meaningful genre groups (with parallel processing)
   */
  async analyzeGenres(tracks, minTracks) {
    console.log(chalk.blue("🎭 Analyzing genre distribution..."));

    // Skip logic: Check if genre analysis should be skipped
    const genreSkipCheck = this.skipLogicManager.shouldSkipBatchOperation(
      "genre_analysis",
      tracks,
      {
        minSize: minTracks,
        cacheKey: `genres_${tracks.length}_${minTracks}`,
      }
    );

    if (genreSkipCheck.skip) {
      console.log(
        chalk.gray(`   ⏭️ Skipping genre analysis: ${genreSkipCheck.reason}`)
      );
      return [];
    }

    // Use parallel processing for large datasets
    if (tracks.length > 500) {
      const genreMap = new Map();

      // Process tracks in parallel chunks
      const genreProcessor = (trackChunk) => {
        const chunkGenreMap = new Map();

        trackChunk.forEach((track) => {
          if (track.artists) {
            track.artists.forEach((artist) => {
              if (artist.genres) {
                artist.genres.forEach((genreName) => {
                  const genre = genreName.toLowerCase().trim();

                  // Skip excluded generic genres
                  if (
                    this.config.excludedGenres.some((excluded) =>
                      genre.includes(excluded)
                    )
                  ) {
                    return;
                  }

                  if (!chunkGenreMap.has(genre)) {
                    chunkGenreMap.set(genre, []);
                  }
                  chunkGenreMap.get(genre).push(track.id);
                });
              }
            });
          }
        });

        return chunkGenreMap;
      };

      // Process chunks in parallel
      const chunkResults = await this.parallelProcessor.processInChunks(
        tracks,
        genreProcessor,
        { chunkSize: 200 }
      );

      // Merge results from all chunks
      chunkResults.forEach((chunkGenreMap) => {
        for (const [genre, trackIds] of chunkGenreMap.entries()) {
          if (!genreMap.has(genre)) {
            genreMap.set(genre, []);
          }
          genreMap.get(genre).push(...trackIds);
        }
      });

      // Convert to array and filter by minimum track count
      const genreGroups = Array.from(genreMap.entries())
        .map(([genre, trackIds]) => ({
          label: this.formatGenreLabel(genre),
          genre,
          trackCount: trackIds.length,
          trackIds: [...new Set(trackIds)], // Remove duplicates
        }))
        .filter((group) => group.trackCount >= minTracks)
        .sort((a, b) => b.trackCount - a.trackCount)
        .slice(0, this.config.maxLabels);

      console.log(
        chalk.gray(
          `   Found ${genreGroups.length} genre groups (parallel processed)`
        )
      );
      return genreGroups;
    } else {
      // Use sequential processing for smaller datasets
      const genreMap = new Map();

      tracks.forEach((track) => {
        if (track.artists) {
          track.artists.forEach((artist) => {
            if (artist.genres) {
              artist.genres.forEach((genreName) => {
                const genre = genreName.toLowerCase().trim();

                // Skip excluded generic genres
                if (
                  this.config.excludedGenres.some((excluded) =>
                    genre.includes(excluded)
                  )
                ) {
                  return;
                }

                if (!genreMap.has(genre)) {
                  genreMap.set(genre, []);
                }
                genreMap.get(genre).push(track.id);
              });
            }
          });
        }
      });

      // Convert to array and filter by minimum track count
      const genreGroups = Array.from(genreMap.entries())
        .map(([genre, trackIds]) => ({
          label: this.formatGenreLabel(genre),
          genre,
          trackCount: trackIds.length,
          trackIds: [...new Set(trackIds)], // Remove duplicates
        }))
        .filter((group) => group.trackCount >= minTracks)
        .sort((a, b) => b.trackCount - a.trackCount)
        .slice(0, this.config.maxLabels);

      console.log(chalk.gray(`   Found ${genreGroups.length} genre groups`));
      return genreGroups;
    }
  }

  /**
   * Analyze decade distribution from release dates
   */
  async analyzeDecades(tracks, minTracks) {
    console.log(chalk.blue("📅 Analyzing decade distribution..."));

    const decadeMap = new Map();

    tracks.forEach((track) => {
      if (track.album && track.album.releaseYear) {
        const year = track.album.releaseYear;
        const decade = Math.floor(year / 10) * 10;
        const decadeLabel = `${decade}s`;

        if (!decadeMap.has(decadeLabel)) {
          decadeMap.set(decadeLabel, []);
        }
        decadeMap.get(decadeLabel).push(track.id);
      }
    });

    const decadeGroups = Array.from(decadeMap.entries())
      .map(([decade, trackIds]) => ({
        label: decade,
        decade,
        trackCount: trackIds.length,
        trackIds: [...new Set(trackIds)],
      }))
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => parseInt(b.decade) - parseInt(a.decade));

    console.log(chalk.gray(`   Found ${decadeGroups.length} decade groups`));
    return decadeGroups;
  }

  /**
   * Analyze BPM (tempo) distribution and create tempo bands
   */
  async analyzeBPMBands(tracks, minTracks) {
    console.log(chalk.blue("🥁 Analyzing BPM distribution..."));

    // Filter tracks with audio features
    const tracksWithBPM = tracks.filter(
      (track) => track.audioFeatures && track.audioFeatures.tempo
    );

    if (tracksWithBPM.length === 0) {
      console.log(
        chalk.yellow(
          "   No audio features available. Run scan with --extended-mode"
        )
      );
      return [];
    }

    const bpmGroups = this.config.bpmRanges
      .map((range) => {
        const tracksInRange = tracksWithBPM.filter(
          (track) =>
            track.audioFeatures.tempo >= range.min &&
            track.audioFeatures.tempo < range.max
        );

        return {
          label: range.name,
          bpmRange: `${range.min}-${range.max} BPM`,
          trackCount: tracksInRange.length,
          trackIds: tracksInRange.map((t) => t.id),
          avgBPM:
            tracksInRange.length > 0
              ? Math.round(
                  tracksInRange.reduce(
                    (sum, t) => sum + t.audioFeatures.tempo,
                    0
                  ) / tracksInRange.length
                )
              : 0,
        };
      })
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => b.trackCount - a.trackCount);

    console.log(chalk.gray(`   Found ${bpmGroups.length} BPM groups`));
    return bpmGroups;
  }

  /**
   * Analyze energy distribution and create energy quartiles
   */
  async analyzeEnergyQuartiles(tracks, minTracks) {
    console.log(chalk.blue("⚡ Analyzing energy distribution..."));

    // Filter tracks with audio features
    const tracksWithEnergy = tracks.filter(
      (track) =>
        track.audioFeatures && typeof track.audioFeatures.energy === "number"
    );

    if (tracksWithEnergy.length === 0) {
      console.log(
        chalk.yellow(
          "   No audio features available. Run scan with --extended-mode"
        )
      );
      return [];
    }

    const energyGroups = this.config.energyQuartiles
      .map((quartile) => {
        const tracksInRange = tracksWithEnergy.filter(
          (track) =>
            track.audioFeatures.energy >= quartile.min &&
            track.audioFeatures.energy < quartile.max
        );

        return {
          label: quartile.name,
          energyRange: `${Math.round(quartile.min * 100)}-${Math.round(
            quartile.max * 100
          )}%`,
          trackCount: tracksInRange.length,
          trackIds: tracksInRange.map((t) => t.id),
          avgEnergy:
            tracksInRange.length > 0
              ? Math.round(
                  (tracksInRange.reduce(
                    (sum, t) => sum + t.audioFeatures.energy,
                    0
                  ) /
                    tracksInRange.length) *
                    100
                )
              : 0,
        };
      })
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => b.trackCount - a.trackCount);

    console.log(chalk.gray(`   Found ${energyGroups.length} energy groups`));
    return energyGroups;
  }

  /**
   * Get all tracks with related metadata from database
   */
  async getAllTracksWithMetadata() {
    try {
      // This would use Prisma to get tracks with related data
      // For now, using a simplified approach
      const tracks = await this.db.getAllTracksWithMetadata();
      return tracks;
    } catch (error) {
      throw new Error(`Failed to fetch tracks: ${error.message}`);
    }
  }

  /**
   * Format genre names for display
   */
  formatGenreLabel(genre) {
    return genre
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Get analysis results
   */
  getResults() {
    return this.analysisResults;
  }

  /**
   * Generate summary statistics
   */
  generateSummary() {
    const results = this.analysisResults;

    return {
      totalTracks: results.totalTracks,
      totalGroups:
        results.genres.length +
        results.decades.length +
        results.bpmBands.length +
        results.energyQuartiles.length,
      categories: {
        genres: results.genres.length,
        decades: results.decades.length,
        bpmBands: results.bpmBands.length,
        energyQuartiles: results.energyQuartiles.length,
      },
      analysisDate: results.analysisDate,
    };
  }

  /**
   * Get cached analysis data for skip logic
   */
  async getCachedAnalysisData(cacheKey) {
    try {
      const cachedResults = await this.cache.getCachedAnalysisResults(cacheKey);
      if (cachedResults) {
        return {
          timestamp: new Date(cachedResults.analysisDate).getTime(),
          value: cachedResults,
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Clean up resources
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
    if (this.cache) {
      await this.cache.shutdown();
    }
    if (this.db) {
      await this.db.disconnect();
    }
  }

  /**
   * Get skip logic metrics
   */
  getSkipMetrics() {
    return this.skipLogicManager.getMetrics();
  }

  /**
   * Streaming analysis for very large datasets
   */
  async analyzeLibraryStreaming(options = {}) {
    const { minTracks = this.config.minTracksPerLabel, onProgress = null } =
      options;

    try {
      console.log(
        chalk.cyan("🌊 Starting streaming music library analysis...")
      );
      const startTime = Date.now();

      // Get database stats for cache key
      const stats = await this.db.getStats();
      const cacheKey = `streaming_analysis_${stats.tracks}_${minTracks}`;

      // Check for cached results first
      const cachedResults = await this.cache.getCachedAnalysisResults(cacheKey);
      if (cachedResults) {
        console.log(chalk.green("📦 Using cached streaming analysis results"));
        this.analysisResults = cachedResults;
        return cachedResults;
      }

      console.log(
        chalk.white(`📊 Streaming analysis of ${stats.tracks} tracks...`)
      );

      // Initialize results containers
      const analysisResults = {
        genres: new Map(),
        decades: new Map(),
        bpmBands: new Map(),
        energyQuartiles: new Map(),
      };

      // Start streaming metrics monitoring
      this.streamProcessor.startMetricsMonitoring();

      // Create streaming pipeline for analysis
      const result = await this.streamProcessor.createPipeline(
        // Source: Generator function for database tracks
        async function* () {
          const batchSize = 1000; // Large batches for database efficiency
          let offset = 0;
          let hasMore = true;

          while (hasMore) {
            try {
              // Get tracks in batches from database
              const tracks = await this.db.getAllTracksWithMetadata({
                limit: batchSize,
                offset,
                includeAudioFeatures: true,
              });

              if (tracks && tracks.length > 0) {
                yield tracks;
                offset += batchSize;
                hasMore = tracks.length === batchSize; // Continue if we got a full batch
              } else {
                hasMore = false;
              }
            } catch (error) {
              console.log(
                chalk.yellow(
                  `⚠️  Database error at offset ${offset}: ${error.message}`
                )
              );
              hasMore = false;
            }
          }
        }.bind(this),

        // Processors: Analyze tracks in streaming fashion
        [
          // Batch processor for analysis
          {
            type: "batch",
            batchSize: 500, // Process 500 tracks at a time
            handler: async (trackBatch) => {
              try {
                // Process genres
                this.processGenresStreaming(trackBatch, analysisResults.genres);

                // Process decades
                this.processDecadesStreaming(
                  trackBatch,
                  analysisResults.decades
                );

                // Process BPM if audio features available
                this.processBPMStreaming(trackBatch, analysisResults.bpmBands);

                // Process energy if audio features available
                this.processEnergyStreaming(
                  trackBatch,
                  analysisResults.energyQuartiles
                );

                // Progress callback
                if (onProgress) {
                  const totalProcessed = Array.from(
                    analysisResults.genres.values()
                  ).reduce((sum, tracks) => sum + tracks.length, 0);

                  onProgress({
                    processed: totalProcessed,
                    total: stats.tracks,
                    percentage: (totalProcessed / stats.tracks) * 100,
                  });
                }

                return {
                  processed: trackBatch.length,
                  genres: analysisResults.genres.size,
                  decades: analysisResults.decades.size,
                  bpmBands: analysisResults.bpmBands.size,
                  energyQuartiles: analysisResults.energyQuartiles.size,
                };
              } catch (error) {
                console.log(
                  chalk.yellow(`⚠️  Analysis error: ${error.message}`)
                );
                return { processed: 0, error: error.message };
              }
            },
          },
        ],

        // Destination: Aggregate results
        async (batchResult) => {
          if (batchResult.processed > 0) {
            console.log(
              chalk.gray(
                `📊 Analyzed ${batchResult.processed} tracks - ` +
                  `${batchResult.genres} genres, ${batchResult.decades} decades, ` +
                  `${batchResult.bpmBands} BPM bands, ${batchResult.energyQuartiles} energy levels`
              )
            );
          }
        },

        // Options
        {
          batch: { batchSize: 500 },
          processing: { enableCaching: true },
        }
      );

      // Stop metrics monitoring
      this.streamProcessor.stopMetricsMonitoring();

      if (result.success) {
        // Convert Maps to final results format
        const finalResults = {
          genres: this.finalizeGenreResults(analysisResults.genres, minTracks),
          decades: this.finalizeDecadeResults(
            analysisResults.decades,
            minTracks
          ),
          bpmBands: this.finalizeBPMResults(
            analysisResults.bpmBands,
            minTracks
          ),
          energyQuartiles: this.finalizeEnergyResults(
            analysisResults.energyQuartiles,
            minTracks
          ),
          totalTracks: stats.tracks,
          analysisDate: new Date().toISOString(),
        };

        const duration = (Date.now() - startTime) / 1000;
        console.log(
          chalk.green(
            `✅ Streaming analysis completed in ${duration.toFixed(1)} seconds`
          )
        );

        // Cache the results
        await this.cache.cacheAnalysisResults(cacheKey, finalResults);

        // Store results locally
        this.analysisResults = finalResults;

        return finalResults;
      } else {
        throw new Error(`Streaming analysis failed: ${result.error}`);
      }
    } catch (error) {
      ErrorHandler.handleGenericError(error, "Streaming Library Analysis");
      throw error;
    }
  }

  /**
   * Process genres in streaming fashion
   */
  processGenresStreaming(tracks, genreMap) {
    tracks.forEach((track) => {
      if (track.artists) {
        track.artists.forEach((artist) => {
          if (artist.genres) {
            artist.genres.forEach((genreName) => {
              const genre = genreName.toLowerCase().trim();

              // Skip excluded genres
              if (
                this.config.excludedGenres.some((excluded) =>
                  genre.includes(excluded)
                )
              ) {
                return;
              }

              if (!genreMap.has(genre)) {
                genreMap.set(genre, []);
              }
              genreMap.get(genre).push(track.id);
            });
          }
        });
      }
    });
  }

  /**
   * Process decades in streaming fashion
   */
  processDecadesStreaming(tracks, decadeMap) {
    tracks.forEach((track) => {
      if (track.album && track.album.releaseYear) {
        const year = track.album.releaseYear;
        const decade = Math.floor(year / 10) * 10;
        const decadeLabel = `${decade}s`;

        if (!decadeMap.has(decadeLabel)) {
          decadeMap.set(decadeLabel, []);
        }
        decadeMap.get(decadeLabel).push(track.id);
      }
    });
  }

  /**
   * Process BPM in streaming fashion
   */
  processBPMStreaming(tracks, bpmMap) {
    const tracksWithBPM = tracks.filter(
      (track) => track.audioFeatures && track.audioFeatures.tempo
    );

    tracksWithBPM.forEach((track) => {
      const tempo = track.audioFeatures.tempo;
      const range = this.config.bpmRanges.find(
        (r) => tempo >= r.min && tempo < r.max
      );

      if (range) {
        if (!bpmMap.has(range.name)) {
          bpmMap.set(range.name, []);
        }
        bpmMap.get(range.name).push(track.id);
      }
    });
  }

  /**
   * Process energy in streaming fashion
   */
  processEnergyStreaming(tracks, energyMap) {
    const tracksWithEnergy = tracks.filter(
      (track) =>
        track.audioFeatures && typeof track.audioFeatures.energy === "number"
    );

    tracksWithEnergy.forEach((track) => {
      const energy = track.audioFeatures.energy;
      const quartile = this.config.energyQuartiles.find(
        (q) => energy >= q.min && energy < q.max
      );

      if (quartile) {
        if (!energyMap.has(quartile.name)) {
          energyMap.set(quartile.name, []);
        }
        energyMap.get(quartile.name).push(track.id);
      }
    });
  }

  /**
   * Finalize genre results from streaming data
   */
  finalizeGenreResults(genreMap, minTracks) {
    return Array.from(genreMap.entries())
      .map(([genre, trackIds]) => ({
        label: this.formatGenreLabel(genre),
        genre,
        trackCount: trackIds.length,
        trackIds: [...new Set(trackIds)],
      }))
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => b.trackCount - a.trackCount)
      .slice(0, this.config.maxLabels);
  }

  /**
   * Finalize decade results from streaming data
   */
  finalizeDecadeResults(decadeMap, minTracks) {
    return Array.from(decadeMap.entries())
      .map(([decade, trackIds]) => ({
        label: decade,
        decade,
        trackCount: trackIds.length,
        trackIds: [...new Set(trackIds)],
      }))
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => parseInt(b.decade) - parseInt(a.decade));
  }

  /**
   * Finalize BPM results from streaming data
   */
  finalizeBPMResults(bpmMap, minTracks) {
    return this.config.bpmRanges
      .map((range) => {
        const trackIds = bpmMap.get(range.name) || [];
        return {
          label: range.name,
          bpmRange: `${range.min}-${range.max} BPM`,
          trackCount: trackIds.length,
          trackIds: [...new Set(trackIds)],
          avgBPM: 0, // Would need to calculate from actual tempo values
        };
      })
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => b.trackCount - a.trackCount);
  }

  /**
   * Finalize energy results from streaming data
   */
  finalizeEnergyResults(energyMap, minTracks) {
    return this.config.energyQuartiles
      .map((quartile) => {
        const trackIds = energyMap.get(quartile.name) || [];
        return {
          label: quartile.name,
          energyRange: `${Math.round(quartile.min * 100)}-${Math.round(
            quartile.max * 100
          )}%`,
          trackCount: trackIds.length,
          trackIds: [...new Set(trackIds)],
          avgEnergy: 0, // Would need to calculate from actual energy values
        };
      })
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => b.trackCount - a.trackCount);
  }

  /**
   * Get streaming processor metrics
   */
  getStreamMetrics() {
    return this.streamProcessor.getOverallMetrics();
  }

  /**
   * Get stored analysis results for preview system
   */
  async getStoredAnalysis() {
    try {
      // If we have analysis results from a recent run, return them
      if (this.analysisResults && this.analysisResults.totalTracks > 0) {
        return this.analysisResults;
      }

      // Try to get cached analysis results
      const stats = await this.db.getStats();
      const cacheKey = `analysis_${stats.tracks}_${this.config.minTracksPerLabel}`;

      const cachedResults = await this.cache.getCachedAnalysisResults(cacheKey);
      if (cachedResults && cachedResults.totalTracks > 0) {
        this.analysisResults = cachedResults;
        return cachedResults;
      }

      // If no cached results, return null to indicate analysis needs to be run
      return null;
    } catch (error) {
      console.log(
        chalk.yellow(`⚠️  Error getting stored analysis: ${error.message}`)
      );
      return null;
    }
  }
}

module.exports = MusicAnalysis;
