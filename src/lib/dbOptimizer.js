/**
 * Database Optimization Module
 *
 * Provides SQLite performance optimizations including indexing, pragma settings,
 * query optimization, and transaction batching for high-performance operations
 */

const chalk = require("chalk");
const ErrorHandler = require("../utils/errorHandler");

class DatabaseOptimizer {
  constructor(prisma) {
    this.prisma = prisma;

    // Optimization configuration
    this.config = {
      // SQLite Pragma settings for performance
      pragmaSettings: {
        journal_mode: "WAL", // Write-Ahead Logging for better concurrency
        synchronous: "NORMAL", // Balance safety vs performance
        cache_size: 10000, // 10MB cache (negative = KB)
        foreign_keys: "ON", // Enforce foreign key constraints
        optimize: true, // Auto-optimize on close
        temp_store: "MEMORY", // Store temp tables in memory
        mmap_size: 268435456, // 256MB memory-mapped I/O
        page_size: 4096, // 4KB page size for better performance
        auto_vacuum: "INCREMENTAL", // Gradual space reclamation
      },

      // Query optimization settings
      queryOptimization: {
        maxBatchSize: 500, // Maximum records per batch operation
        indexAnalysisEnabled: true, // Monitor index usage
        slowQueryThreshold: 1000, // Log queries slower than 1s
        enableQueryPlan: false, // Log query execution plans (debug only)
      },

      // Connection optimization
      connectionSettings: {
        connectionTimeout: 10000, // 10 second connection timeout
        maxRetries: 3, // Connection retry attempts
        retryDelay: 1000, // Delay between retries
      },
    };

    // Performance monitoring
    this.metrics = {
      queryCount: 0,
      totalQueryTime: 0,
      slowQueries: 0,
      optimizationsApplied: 0,
      indexesCreated: 0,
      batchOperations: 0,
    };

    console.log(chalk.green("✅ DatabaseOptimizer initialized"));
  }

  /**
   * Apply all database optimizations
   */
  async optimize() {
    try {
      console.log(chalk.blue("🔧 Applying database optimizations..."));

      await this.applyPragmaSettings();
      await this.createPerformanceIndexes();
      await this.optimizeExistingData();

      console.log(chalk.green("✅ Database optimization completed"));
      return {
        success: true,
        optimizationsApplied: this.metrics.optimizationsApplied,
      };
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Database Optimization");
      return { success: false, error: error.message };
    }
  }

  /**
   * Apply SQLite PRAGMA settings for optimal performance
   */
  async applyPragmaSettings() {
    console.log(chalk.blue("📝 Applying SQLite PRAGMA settings..."));

    try {
      const settings = this.config.pragmaSettings;

      // Apply each pragma setting
      for (const [pragma, value] of Object.entries(settings)) {
        if (pragma === "optimize") {
          // Special case: run PRAGMA optimize
          await this.prisma.$executeRaw`PRAGMA optimize`;
        } else {
          const query = `PRAGMA ${pragma} = ${value}`;
          await this.prisma.$executeRawUnsafe(query);
        }

        this.metrics.optimizationsApplied++;
      }

      console.log(
        chalk.green(
          `✅ Applied ${Object.keys(settings).length} PRAGMA settings`
        )
      );
    } catch (error) {
      console.log(
        chalk.yellow(`⚠️ Error applying PRAGMA settings: ${error.message}`)
      );
    }
  }

  /**
   * Create performance-critical indexes
   */
  async createPerformanceIndexes() {
    console.log(chalk.blue("📊 Creating performance indexes..."));

    const indexes = [
      // Track indexes for common queries
      {
        name: "idx_tracks_added_at",
        table: "tracks",
        sql: "CREATE INDEX IF NOT EXISTS idx_tracks_added_at ON tracks(added_at DESC)",
      },
      {
        name: "idx_tracks_popularity",
        table: "tracks",
        sql: "CREATE INDEX IF NOT EXISTS idx_tracks_popularity ON tracks(popularity DESC)",
      },
      {
        name: "idx_tracks_album_id",
        table: "tracks",
        sql: "CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id)",
      },

      // Album indexes for release date queries
      {
        name: "idx_albums_release_year",
        table: "albums",
        sql: "CREATE INDEX IF NOT EXISTS idx_albums_release_year ON albums(release_year DESC)",
      },
      {
        name: "idx_albums_album_type",
        table: "albums",
        sql: "CREATE INDEX IF NOT EXISTS idx_albums_album_type ON albums(album_type)",
      },

      // Artist indexes for genre queries
      {
        name: "idx_artists_popularity",
        table: "artists",
        sql: "CREATE INDEX IF NOT EXISTS idx_artists_popularity ON artists(popularity DESC)",
      },
      {
        name: "idx_artists_name",
        table: "artists",
        sql: "CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name COLLATE NOCASE)",
      },

      // Junction table indexes for joins
      {
        name: "idx_track_artists_track_id",
        table: "track_artists",
        sql: "CREATE INDEX IF NOT EXISTS idx_track_artists_track_id ON track_artists(track_id)",
      },
      {
        name: "idx_track_artists_artist_id",
        table: "track_artists",
        sql: "CREATE INDEX IF NOT EXISTS idx_track_artists_artist_id ON track_artists(artist_id)",
      },
      {
        name: "idx_track_artists_position",
        table: "track_artists",
        sql: "CREATE INDEX IF NOT EXISTS idx_track_artists_position ON track_artists(track_id, position)",
      },

      // Genre indexes for analysis queries
      {
        name: "idx_genres_name",
        table: "genres",
        sql: "CREATE INDEX IF NOT EXISTS idx_genres_name ON genres(name COLLATE NOCASE)",
      },
      {
        name: "idx_genres_track_count",
        table: "genres",
        sql: "CREATE INDEX IF NOT EXISTS idx_genres_track_count ON genres(track_count DESC)",
      },

      // Artist-Genre junction indexes
      {
        name: "idx_artist_genres_artist_id",
        table: "artist_genres",
        sql: "CREATE INDEX IF NOT EXISTS idx_artist_genres_artist_id ON artist_genres(artist_id)",
      },
      {
        name: "idx_artist_genres_genre_id",
        table: "artist_genres",
        sql: "CREATE INDEX IF NOT EXISTS idx_artist_genres_genre_id ON artist_genres(genre_id)",
      },

      // Audio features indexes for analysis
      {
        name: "idx_audio_features_tempo",
        table: "audio_features",
        sql: "CREATE INDEX IF NOT EXISTS idx_audio_features_tempo ON audio_features(tempo)",
      },
      {
        name: "idx_audio_features_energy",
        table: "audio_features",
        sql: "CREATE INDEX IF NOT EXISTS idx_audio_features_energy ON audio_features(energy)",
      },
      {
        name: "idx_audio_features_danceability",
        table: "audio_features",
        sql: "CREATE INDEX IF NOT EXISTS idx_audio_features_danceability ON audio_features(danceability)",
      },
      {
        name: "idx_audio_features_valence",
        table: "audio_features",
        sql: "CREATE INDEX IF NOT EXISTS idx_audio_features_valence ON audio_features(valence)",
      },

      // Scan history indexes for monitoring
      {
        name: "idx_scan_history_start_time",
        table: "scan_history",
        sql: "CREATE INDEX IF NOT EXISTS idx_scan_history_start_time ON scan_history(start_time DESC)",
      },
      {
        name: "idx_scan_history_status",
        table: "scan_history",
        sql: "CREATE INDEX IF NOT EXISTS idx_scan_history_status ON scan_history(status)",
      },

      // Playlist indexes for future functionality
      {
        name: "idx_generated_playlists_category",
        table: "generated_playlists",
        sql: "CREATE INDEX IF NOT EXISTS idx_generated_playlists_category ON generated_playlists(category_type, category_value)",
      },
      {
        name: "idx_playlist_tracks_playlist_id",
        table: "playlist_tracks",
        sql: "CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON playlist_tracks(playlist_id, position)",
      },
    ];

    // Create indexes
    for (const index of indexes) {
      try {
        await this.prisma.$executeRawUnsafe(index.sql);
        this.metrics.indexesCreated++;
        console.log(chalk.gray(`   ✓ Created ${index.name}`));
      } catch (error) {
        // Ignore "index already exists" errors
        if (!error.message.includes("already exists")) {
          console.log(
            chalk.yellow(
              `   ⚠️ Failed to create ${index.name}: ${error.message}`
            )
          );
        }
      }
    }

    console.log(
      chalk.green(
        `✅ Created ${this.metrics.indexesCreated} performance indexes`
      )
    );
  }

  /**
   * Optimize existing data (update statistics, cleanup, etc.)
   */
  async optimizeExistingData() {
    console.log(chalk.blue("🧹 Optimizing existing data..."));

    try {
      // Update genre track counts (denormalized for performance)
      await this.updateGenreTrackCounts();

      // Run SQLite ANALYZE command to update query planner statistics
      await this.prisma.$executeRaw`ANALYZE`;

      // Run VACUUM to reclaim space (if needed)
      await this.conditionalVacuum();

      console.log(chalk.green("✅ Data optimization completed"));
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Error optimizing data: ${error.message}`));
    }
  }

  /**
   * Update denormalized genre track counts for better query performance
   */
  async updateGenreTrackCounts() {
    try {
      // Update genre track counts based on actual data
      await this.prisma.$executeRaw`
        UPDATE genres 
        SET track_count = (
          SELECT COUNT(DISTINCT ta.track_id)
          FROM artist_genres ag
          JOIN track_artists ta ON ag.artist_id = ta.artist_id
          WHERE ag.genre_id = genres.id
        )
      `;

      console.log(chalk.gray("   ✓ Updated genre track counts"));
    } catch (error) {
      console.log(
        chalk.yellow(`   ⚠️ Error updating genre counts: ${error.message}`)
      );
    }
  }

  /**
   * Run VACUUM if database fragmentation is significant
   */
  async conditionalVacuum() {
    try {
      // Check database size and fragmentation
      const pageCount = await this.prisma.$queryRaw`PRAGMA page_count`;
      const freelist = await this.prisma.$queryRaw`PRAGMA freelist_count`;

      const totalPages = pageCount[0]?.page_count || 0;
      const freePages = freelist[0]?.freelist_count || 0;

      // Run VACUUM if more than 25% fragmentation
      if (totalPages > 1000 && freePages > totalPages * 0.25) {
        console.log(chalk.blue("   🧹 Running VACUUM to reclaim space..."));
        await this.prisma.$executeRaw`VACUUM`;
        console.log(chalk.gray("   ✓ VACUUM completed"));
      }
    } catch (error) {
      console.log(
        chalk.yellow(`   ⚠️ Error checking fragmentation: ${error.message}`)
      );
    }
  }

  /**
   * Create optimized batch operation for bulk inserts/updates
   */
  async batchOperation(operation, items, batchSize = null) {
    const size = batchSize || this.config.queryOptimization.maxBatchSize;
    const results = [];

    try {
      for (let i = 0; i < items.length; i += size) {
        const batch = items.slice(i, i + size);

        const result = await this.prisma.$transaction(async (tx) => {
          return await operation(tx, batch);
        });

        results.push(result);
        this.metrics.batchOperations++;
      }

      return results;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Batch Operation");
      throw error;
    }
  }

  /**
   * Monitor query performance
   */
  startQueryMonitoring() {
    if (!this.config.queryOptimization.enableQueryPlan) return;

    // This would integrate with Prisma's query events
    // For now, we'll track basic metrics
    const originalQuery = this.prisma.$use;

    this.prisma.$use(async (params, next) => {
      const startTime = Date.now();

      try {
        const result = await next(params);
        const queryTime = Date.now() - startTime;

        this.metrics.queryCount++;
        this.metrics.totalQueryTime += queryTime;

        if (queryTime > this.config.queryOptimization.slowQueryThreshold) {
          this.metrics.slowQueries++;
          console.log(
            chalk.yellow(
              `⚠️ Slow query detected: ${params.action} (${queryTime}ms)`
            )
          );
        }

        return result;
      } catch (error) {
        console.log(
          chalk.red(`❌ Query error: ${params.action} - ${error.message}`)
        );
        throw error;
      }
    });
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      avgQueryTime:
        this.metrics.queryCount > 0
          ? (this.metrics.totalQueryTime / this.metrics.queryCount).toFixed(2)
          : 0,
      slowQueryPercentage:
        this.metrics.queryCount > 0
          ? (
              (this.metrics.slowQueries / this.metrics.queryCount) *
              100
            ).toFixed(2)
          : 0,
    };
  }

  /**
   * Generate optimization report
   */
  async generateOptimizationReport() {
    const tableStats = await this.getTableStatistics();
    const indexStats = await this.getIndexStatistics();
    const metrics = this.getMetrics();

    return {
      timestamp: new Date().toISOString(),
      tableStats,
      indexStats,
      performanceMetrics: metrics,
      recommendations: await this.generateOptimizationRecommendations(
        tableStats,
        indexStats
      ),
    };
  }

  /**
   * Get statistics for all tables
   */
  async getTableStatistics() {
    const tables = [
      "tracks",
      "albums",
      "artists",
      "track_artists",
      "genres",
      "artist_genres",
      "audio_features",
      "scan_history",
      "generated_playlists",
      "playlist_tracks",
    ];

    const stats = {};

    for (const table of tables) {
      try {
        const result = await this.prisma.$queryRawUnsafe(
          `SELECT COUNT(*) as count FROM ${table}`
        );
        stats[table] = result[0]?.count || 0;
      } catch (error) {
        stats[table] = 0;
      }
    }

    return stats;
  }

  /**
   * Get index usage statistics
   */
  async getIndexStatistics() {
    try {
      // Get list of all indexes
      const indexes = await this.prisma.$queryRaw`
        SELECT name, sql FROM sqlite_master 
        WHERE type = 'index' AND sql IS NOT NULL
        ORDER BY name
      `;

      return indexes.map((index) => ({
        name: index.name,
        definition: index.sql,
      }));
    } catch (error) {
      console.log(
        chalk.yellow(`⚠️ Error getting index statistics: ${error.message}`)
      );
      return [];
    }
  }

  /**
   * Generate optimization recommendations
   */
  async generateOptimizationRecommendations(tableStats, indexStats) {
    const recommendations = [];

    // Check for large tables without proper indexing
    Object.entries(tableStats).forEach(([table, count]) => {
      if (count > 10000) {
        recommendations.push({
          type: "performance",
          table,
          message: `Large table (${count} rows) - ensure proper indexing for frequent queries`,
          priority: "high",
        });
      }
    });

    // Check for missing foreign key indexes
    const foreignKeyTables = [
      "track_artists",
      "artist_genres",
      "playlist_tracks",
    ];
    foreignKeyTables.forEach((table) => {
      if (tableStats[table] > 1000) {
        recommendations.push({
          type: "indexing",
          table,
          message: `Junction table with ${tableStats[table]} rows - verify composite indexes exist`,
          priority: "medium",
        });
      }
    });

    return recommendations;
  }
}

module.exports = DatabaseOptimizer;
