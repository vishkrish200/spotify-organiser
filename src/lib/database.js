/**
 * Database Service for Spotify Organizer
 *
 * Handles all SQLite operations for caching track data, genres, and audio features
 * Uses Prisma Client for type-safe database operations
 */

const { PrismaClient } = require("@prisma/client");
const chalk = require("chalk");
const DatabaseOptimizer = require("./dbOptimizer");
const MemoryOptimizer = require("./memoryOptimizer");
const ErrorHandler = require("../utils/errorHandler");

class DatabaseService {
  constructor() {
    this.prisma = new PrismaClient({
      log:
        process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
    });

    this.optimizer = new DatabaseOptimizer(this.prisma);
    this.memoryOptimizer = new MemoryOptimizer({
      monitoringInterval: 60000, // 1 minute for database operations
      memoryWarningThreshold: 300 * 1024 * 1024, // 300MB warning for DB operations
      enableObjectPooling: true,
    });

    this.isConnected = false;
    this.isOptimized = false;

    // Register database-specific cleanup handlers
    this.memoryOptimizer.registerCleanupHandler(() => {
      this.performDatabaseCleanup();
    });
  }

  /**
   * Initialize database connection and run optimizations
   */
  async initialize() {
    try {
      // Test connection
      await this.prisma.$connect();

      // Verify database schema by running a simple query
      await this.prisma.appConfig.findMany({ take: 1 });

      this.isConnected = true;
      console.log(chalk.green("✅ Database connected successfully"));

      // Apply database optimizations for better performance
      if (!this.isOptimized) {
        const optimizationResult = await this.optimizer.optimize();
        if (optimizationResult.success) {
          this.isOptimized = true;
          console.log(
            chalk.green(
              `✅ Database optimized (${optimizationResult.optimizationsApplied} applied)`
            )
          );
        }
      }

      return true;
    } catch (error) {
      console.log(chalk.red("❌ Database connection failed"));
      ErrorHandler.handleStorageError(error, "Database Initialization");
      return false;
    }
  }

  /**
   * Database-specific cleanup for memory optimization
   */
  performDatabaseCleanup() {
    // This method is called by MemoryOptimizer during cleanup
    console.log(chalk.blue("🧹 Performing database memory cleanup..."));

    // Clear any cached data structures if they exist
    // This is a placeholder for future database-specific cleanup
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    try {
      // Shutdown memory optimizer first
      if (this.memoryOptimizer) {
        await this.memoryOptimizer.shutdown();
      }

      await this.prisma.$disconnect();
      this.isConnected = false;
      console.log(chalk.gray("📤 Database disconnected"));
    } catch (error) {
      console.log(chalk.yellow("⚠️  Error disconnecting from database"));
    }
  }

  // =====================================
  // Track Data Operations
  // =====================================

  /**
   * Store a batch of tracks from Spotify API response (optimized)
   */
  async storeTracks(spotifyTracks, scanId = null) {
    // Use optimized batch processing for large datasets
    if (spotifyTracks.length > 100) {
      return this.storeTracksOptimized(spotifyTracks, scanId);
    }

    const transaction = await this.prisma.$transaction(async (tx) => {
      const stats = {
        tracksAdded: 0,
        tracksUpdated: 0,
        albumsAdded: 0,
        artistsAdded: 0,
      };

      for (const item of spotifyTracks) {
        const { track, added_at } = item;

        if (!track || !track.id) {
          console.log(chalk.yellow("⚠️  Skipping invalid track"));
          continue;
        }

        try {
          // Store album first
          const album = await this.storeAlbum(tx, track.album);
          if (album.isNew) stats.albumsAdded++;

          // Store artists
          const artistIds = [];
          for (let i = 0; i < track.artists.length; i++) {
            const artist = await this.storeArtist(tx, track.artists[i]);
            if (artist.isNew) stats.artistsAdded++;
            artistIds.push({ id: artist.id, position: i });
          }

          // Store track
          const existingTrack = await tx.track.findUnique({
            where: { id: track.id },
          });

          if (existingTrack) {
            // Update existing track
            await tx.track.update({
              where: { id: track.id },
              data: {
                name: track.name,
                durationMs: track.duration_ms,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                explicit: track.explicit,
                updatedAt: new Date(),
              },
            });
            stats.tracksUpdated++;
          } else {
            // Create new track
            await tx.track.create({
              data: {
                id: track.id,
                name: track.name,
                durationMs: track.duration_ms,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                explicit: track.explicit,
                isLocal: track.is_local || false,
                addedAt: new Date(added_at),
                albumId: track.album.id,
              },
            });
            stats.tracksAdded++;
          }

          // Handle track-artist relationships
          await this.updateTrackArtists(tx, track.id, artistIds);
        } catch (error) {
          console.log(
            chalk.yellow(
              `⚠️  Error storing track ${track.id}: ${error.message}`
            )
          );
        }
      }

      return stats;
    });

    return transaction;
  }

  /**
   * Optimized batch storage for large track datasets
   */
  async storeTracksOptimized(spotifyTracks, scanId = null) {
    console.log(
      chalk.blue(
        `📦 Using optimized batch storage for ${spotifyTracks.length} tracks`
      )
    );

    const batchOperation = async (tx, batch) => {
      const stats = {
        tracksAdded: 0,
        tracksUpdated: 0,
        albumsAdded: 0,
        artistsAdded: 0,
      };

      // Pre-process albums and artists to avoid repeated lookups
      const albumMap = new Map();
      const artistMap = new Map();

      // Collect unique albums and artists
      for (const item of batch) {
        const { track } = item;
        if (!track || !track.id) continue;

        // Collect albums
        if (track.album && !albumMap.has(track.album.id)) {
          albumMap.set(track.album.id, track.album);
        }

        // Collect artists
        if (track.artists) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.id)) {
              artistMap.set(artist.id, artist);
            }
          }
        }
      }

      // Batch process albums
      for (const [albumId, albumData] of albumMap) {
        const result = await this.storeAlbum(tx, albumData);
        if (result.isNew) stats.albumsAdded++;
      }

      // Batch process artists
      for (const [artistId, artistData] of artistMap) {
        const result = await this.storeArtist(tx, artistData);
        if (result.isNew) stats.artistsAdded++;
      }

      // Batch process tracks with optimized approach
      for (const item of batch) {
        const { track, added_at } = item;
        if (!track || !track.id) continue;

        try {
          const existingTrack = await tx.track.findUnique({
            where: { id: track.id },
          });

          if (existingTrack) {
            await tx.track.update({
              where: { id: track.id },
              data: {
                name: track.name,
                durationMs: track.duration_ms,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                explicit: track.explicit,
                updatedAt: new Date(),
              },
            });
            stats.tracksUpdated++;
          } else {
            await tx.track.create({
              data: {
                id: track.id,
                name: track.name,
                durationMs: track.duration_ms,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                explicit: track.explicit,
                isLocal: track.is_local || false,
                addedAt: new Date(added_at),
                albumId: track.album.id,
              },
            });
            stats.tracksAdded++;
          }

          // Handle track-artist relationships efficiently
          const artistIds = track.artists.map((artist, index) => ({
            id: artist.id,
            position: index,
          }));
          await this.updateTrackArtists(tx, track.id, artistIds);
        } catch (error) {
          console.log(
            chalk.yellow(`⚠️ Error storing track ${track.id}: ${error.message}`)
          );
        }
      }

      return stats;
    };

    // Use the optimizer's batch operation method
    try {
      const results = await this.optimizer.batchOperation(
        batchOperation,
        spotifyTracks,
        50
      );

      // Aggregate results
      const totalStats = results.reduce(
        (acc, result) => ({
          tracksAdded: acc.tracksAdded + result.tracksAdded,
          tracksUpdated: acc.tracksUpdated + result.tracksUpdated,
          albumsAdded: acc.albumsAdded + result.albumsAdded,
          artistsAdded: acc.artistsAdded + result.artistsAdded,
        }),
        { tracksAdded: 0, tracksUpdated: 0, albumsAdded: 0, artistsAdded: 0 }
      );

      console.log(
        chalk.green(
          `✅ Optimized batch storage completed: ${totalStats.tracksAdded} added, ${totalStats.tracksUpdated} updated`
        )
      );

      return totalStats;
    } catch (error) {
      console.log(
        chalk.red(`❌ Optimized batch storage failed: ${error.message}`)
      );
      // Fallback to regular storage
      return this.storeTracksRegular(spotifyTracks, scanId);
    }
  }

  /**
   * Regular batch storage (fallback method)
   */
  async storeTracksRegular(spotifyTracks, scanId = null) {
    const transaction = await this.prisma.$transaction(async (tx) => {
      const stats = {
        tracksAdded: 0,
        tracksUpdated: 0,
        albumsAdded: 0,
        artistsAdded: 0,
      };

      for (const item of spotifyTracks) {
        const { track, added_at } = item;
        if (!track || !track.id) continue;

        try {
          const album = await this.storeAlbum(tx, track.album);
          if (album.isNew) stats.albumsAdded++;

          const artistIds = [];
          for (let i = 0; i < track.artists.length; i++) {
            const artist = await this.storeArtist(tx, track.artists[i]);
            if (artist.isNew) stats.artistsAdded++;
            artistIds.push({ id: artist.id, position: i });
          }

          const existingTrack = await tx.track.findUnique({
            where: { id: track.id },
          });

          if (existingTrack) {
            await tx.track.update({
              where: { id: track.id },
              data: {
                name: track.name,
                durationMs: track.duration_ms,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                explicit: track.explicit,
                updatedAt: new Date(),
              },
            });
            stats.tracksUpdated++;
          } else {
            await tx.track.create({
              data: {
                id: track.id,
                name: track.name,
                durationMs: track.duration_ms,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                explicit: track.explicit,
                isLocal: track.is_local || false,
                addedAt: new Date(added_at),
                albumId: track.album.id,
              },
            });
            stats.tracksAdded++;
          }

          await this.updateTrackArtists(tx, track.id, artistIds);
        } catch (error) {
          console.log(
            chalk.yellow(`⚠️ Error storing track ${track.id}: ${error.message}`)
          );
        }
      }

      return stats;
    });

    return transaction;
  }

  /**
   * Store album information
   */
  async storeAlbum(tx, albumData) {
    try {
      const existing = await tx.album.findUnique({
        where: { id: albumData.id },
      });

      if (existing) {
        return { id: existing.id, isNew: false };
      }

      const album = await tx.album.create({
        data: {
          id: albumData.id,
          name: albumData.name,
          releaseDate: albumData.release_date,
          releaseYear: this.extractYearFromDate(albumData.release_date),
          totalTracks: albumData.total_tracks,
          albumType: albumData.album_type,
          imageUrl: albumData.images?.[0]?.url,
        },
      });

      return { id: album.id, isNew: true };
    } catch (error) {
      console.log(
        chalk.yellow(
          `⚠️  Error storing album ${albumData.id}: ${error.message}`
        )
      );
      return { id: albumData.id, isNew: false };
    }
  }

  /**
   * Store artist information
   */
  async storeArtist(tx, artistData) {
    try {
      const existing = await tx.artist.findUnique({
        where: { id: artistData.id },
      });

      if (existing) {
        return { id: existing.id, isNew: false };
      }

      const artist = await tx.artist.create({
        data: {
          id: artistData.id,
          name: artistData.name,
          popularity: artistData.popularity || 0,
          imageUrl: artistData.images?.[0]?.url,
        },
      });

      return { id: artist.id, isNew: true };
    } catch (error) {
      console.log(
        chalk.yellow(
          `⚠️  Error storing artist ${artistData.id}: ${error.message}`
        )
      );
      return { id: artistData.id, isNew: false };
    }
  }

  /**
   * Update track-artist relationships
   */
  async updateTrackArtists(tx, trackId, artistIds) {
    // Remove existing relationships
    await tx.trackArtist.deleteMany({
      where: { trackId },
    });

    // Create new relationships
    for (const artist of artistIds) {
      await tx.trackArtist.create({
        data: {
          trackId,
          artistId: artist.id,
          position: artist.position,
        },
      });
    }
  }

  // =====================================
  // Extended Mode Data (Genres & Audio Features)
  // =====================================

  /**
   * Store artist genres
   */
  async storeArtistGenres(artistGenres) {
    try {
      for (const [artistId, genres] of Object.entries(artistGenres)) {
        for (const genreName of genres) {
          // Find or create genre
          let genre = await this.prisma.genre.findUnique({
            where: { name: genreName },
          });

          if (!genre) {
            genre = await this.prisma.genre.create({
              data: { name: genreName },
            });
          }

          // Create artist-genre relationship (if not exists)
          await this.prisma.artistGenre.upsert({
            where: {
              artistId_genreId: {
                artistId,
                genreId: genre.id,
              },
            },
            update: {},
            create: {
              artistId,
              genreId: genre.id,
            },
          });
        }
      }

      console.log(
        chalk.green(
          `✅ Stored genres for ${Object.keys(artistGenres).length} artists`
        )
      );
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Artist Genres Storage");
    }
  }

  /**
   * Store audio features
   */
  async storeAudioFeatures(audioFeaturesData) {
    try {
      const stored = [];

      for (const [trackId, features] of Object.entries(audioFeaturesData)) {
        if (!features) continue;

        await this.prisma.audioFeatures.upsert({
          where: { trackId },
          update: {
            danceability: features.danceability,
            energy: features.energy,
            key: features.key,
            loudness: features.loudness,
            mode: features.mode,
            speechiness: features.speechiness,
            acousticness: features.acousticness,
            instrumentalness: features.instrumentalness,
            liveness: features.liveness,
            valence: features.valence,
            tempo: features.tempo,
            timeSignature: features.time_signature,
            updatedAt: new Date(),
          },
          create: {
            trackId,
            danceability: features.danceability,
            energy: features.energy,
            key: features.key,
            loudness: features.loudness,
            mode: features.mode,
            speechiness: features.speechiness,
            acousticness: features.acousticness,
            instrumentalness: features.instrumentalness,
            liveness: features.liveness,
            valence: features.valence,
            tempo: features.tempo,
            timeSignature: features.time_signature,
          },
        });

        stored.push(trackId);
      }

      console.log(
        chalk.green(`✅ Stored audio features for ${stored.length} tracks`)
      );
      return stored;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Audio Features Storage");
      return [];
    }
  }

  // =====================================
  // Scan History Operations
  // =====================================

  /**
   * Create a new scan record
   */
  async createScanRecord(scanType, totalTracks, spotifyUserId) {
    try {
      const scan = await this.prisma.scanHistory.create({
        data: {
          scanType,
          status: "in_progress",
          totalTracks,
          tracksProcessed: 0,
          tracksAdded: 0,
          tracksUpdated: 0,
          startTime: new Date(),
          spotifyUserId,
        },
      });

      return scan.id;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Scan Record Creation");
      return null;
    }
  }

  /**
   * Update scan progress
   */
  async updateScanProgress(scanId, stats) {
    try {
      await this.prisma.scanHistory.update({
        where: { id: scanId },
        data: {
          tracksProcessed: stats.tracksProcessed || 0,
          tracksAdded: stats.tracksAdded || 0,
          tracksUpdated: stats.tracksUpdated || 0,
          genresFetched: stats.genresFetched || 0,
          audioFeaturesFetched: stats.audioFeaturesFetched || 0,
          errorCount: stats.errorCount || 0,
        },
      });
    } catch (error) {
      console.log(
        chalk.yellow(`⚠️  Error updating scan progress: ${error.message}`)
      );
    }
  }

  /**
   * Complete scan record
   */
  async completeScan(scanId, status = "completed", errorMessage = null) {
    try {
      const endTime = new Date();
      const scan = await this.prisma.scanHistory.findUnique({
        where: { id: scanId },
      });

      const duration = scan
        ? Math.floor((endTime - scan.startTime) / 1000)
        : null;

      await this.prisma.scanHistory.update({
        where: { id: scanId },
        data: {
          status,
          endTime,
          duration,
          errorMessage,
        },
      });

      console.log(chalk.green(`✅ Scan ${scanId} marked as ${status}`));
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Error completing scan: ${error.message}`));
    }
  }

  // =====================================
  // Preview System Support Methods
  // =====================================

  /**
   * Get total count of cached tracks
   */
  async getTrackCount() {
    try {
      return await this.prisma.track.count();
    } catch (error) {
      console.log(
        chalk.yellow(`⚠️  Error getting track count: ${error.message}`)
      );
      return 0;
    }
  }

  /**
   * Check if analysis data exists
   */
  async hasAnalysisData() {
    try {
      // Check if any analysis data exists in the database
      const genreCount = await this.prisma.genre.count();
      const audioFeaturesCount = await this.prisma.audioFeatures.count();

      // We need at least some genres or audio features to consider analysis data available
      return genreCount > 0 || audioFeaturesCount > 0;
    } catch (error) {
      console.log(
        chalk.yellow(`⚠️  Error checking analysis data: ${error.message}`)
      );
      return false;
    }
  }

  // =====================================
  // Query Operations
  // =====================================

  /**
   * Get all cached tracks with relationships
   */
  async getAllTracks(includeAudioFeatures = false) {
    try {
      const tracks = await this.prisma.track.findMany({
        include: {
          album: true,
          trackArtists: {
            include: {
              artist: {
                include: {
                  artistGenres: {
                    include: {
                      genre: true,
                    },
                  },
                },
              },
            },
            orderBy: { position: "asc" },
          },
          audioFeatures: includeAudioFeatures,
        },
        orderBy: { addedAt: "desc" },
      });

      return tracks;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Track Query");
      return [];
    }
  }

  /**
   * Get all tracks with metadata for analysis (formatted for MusicAnalysis module)
   */
  async getAllTracksWithMetadata() {
    try {
      const tracks = await this.prisma.track.findMany({
        include: {
          album: true,
          trackArtists: {
            include: {
              artist: {
                include: {
                  artistGenres: {
                    include: {
                      genre: true,
                    },
                  },
                },
              },
            },
            orderBy: { position: "asc" },
          },
          audioFeatures: true,
        },
        orderBy: { addedAt: "desc" },
      });

      // Transform the data into a format suitable for analysis
      return tracks.map((track) => ({
        id: track.id,
        name: track.name,
        duration: track.durationMs,
        popularity: track.popularity,
        explicit: track.explicit,
        addedAt: track.addedAt,

        album: {
          id: track.album.id,
          name: track.album.name,
          releaseDate: track.album.releaseDate,
          releaseYear: track.album.releaseYear,
          albumType: track.album.albumType,
          totalTracks: track.album.totalTracks,
        },

        artists: track.trackArtists.map((ta) => ({
          id: ta.artist.id,
          name: ta.artist.name,
          popularity: ta.artist.popularity,
          position: ta.position,
          genres: ta.artist.artistGenres.map((ag) => ag.genre.name),
        })),

        audioFeatures: track.audioFeatures
          ? {
              danceability: track.audioFeatures.danceability,
              energy: track.audioFeatures.energy,
              key: track.audioFeatures.key,
              loudness: track.audioFeatures.loudness,
              mode: track.audioFeatures.mode,
              speechiness: track.audioFeatures.speechiness,
              acousticness: track.audioFeatures.acousticness,
              instrumentalness: track.audioFeatures.instrumentalness,
              liveness: track.audioFeatures.liveness,
              valence: track.audioFeatures.valence,
              tempo: track.audioFeatures.tempo,
              timeSignature: track.audioFeatures.timeSignature,
            }
          : null,
      }));
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Track Analysis Query");
      return [];
    }
  }

  /**
   * Get scan history
   */
  async getScanHistory(limit = 10) {
    try {
      const scans = await this.prisma.scanHistory.findMany({
        orderBy: { startTime: "desc" },
        take: limit,
      });

      return scans;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Scan History Query");
      return [];
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    try {
      const [
        trackCount,
        albumCount,
        artistCount,
        genreCount,
        audioFeaturesCount,
        lastScan,
      ] = await Promise.all([
        this.prisma.track.count(),
        this.prisma.album.count(),
        this.prisma.artist.count(),
        this.prisma.genre.count(),
        this.prisma.audioFeatures.count(),
        this.prisma.scanHistory.findFirst({
          where: { status: "completed" },
          orderBy: { endTime: "desc" },
        }),
      ]);

      return {
        tracks: trackCount,
        albums: albumCount,
        artists: artistCount,
        genres: genreCount,
        audioFeatures: audioFeaturesCount,
        lastScan: lastScan?.endTime || null,
      };
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Database Stats");
      return null;
    }
  }

  // =====================================
  // Utility Methods
  // =====================================

  /**
   * Extract year from Spotify date string
   */
  extractYearFromDate(dateString) {
    if (!dateString) return new Date().getFullYear();

    // Handle different date formats from Spotify
    const year = parseInt(dateString.split("-")[0]);
    return isNaN(year) ? new Date().getFullYear() : year;
  }

  /**
   * Clear all data (for testing)
   */
  async clearAllData() {
    try {
      await this.prisma.$transaction([
        this.prisma.playlistTrack.deleteMany(),
        this.prisma.generatedPlaylist.deleteMany(),
        this.prisma.trackArtist.deleteMany(),
        this.prisma.artistGenre.deleteMany(),
        this.prisma.audioFeatures.deleteMany(),
        this.prisma.track.deleteMany(),
        this.prisma.album.deleteMany(),
        this.prisma.artist.deleteMany(),
        this.prisma.genre.deleteMany(),
        this.prisma.scanHistory.deleteMany(),
        this.prisma.appConfig.deleteMany(),
      ]);

      console.log(chalk.yellow("🗑️  All data cleared from database"));
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Data Clearing");
    }
  }

  /**
   * Check if database is properly initialized
   */
  async isInitialized() {
    try {
      await this.prisma.appConfig.findMany({ take: 1 });
      return true;
    } catch (error) {
      return false;
    }
  }

  // =====================================
  // Playlist Management Operations
  // =====================================

  /**
   * Store generated playlist mapping
   */
  async storeGeneratedPlaylist(playlistData) {
    try {
      const playlist = await this.prisma.generatedPlaylist.create({
        data: {
          key: playlistData.key,
          spotifyId: playlistData.spotifyId,
          name: playlistData.name,
          category: playlistData.category,
          trackCount: playlistData.trackCount,
          groupData: playlistData.groupData,
          createdAt: new Date(),
        },
      });

      console.log(
        chalk.green(`✅ Stored playlist mapping: ${playlistData.name}`)
      );
      return playlist;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Generated Playlist Storage");
      throw error;
    }
  }

  /**
   * Find existing playlist by key
   */
  async findPlaylistByKey(key) {
    try {
      const playlist = await this.prisma.generatedPlaylist.findUnique({
        where: { key },
      });

      return playlist;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Playlist Key Lookup");
      return null;
    }
  }

  /**
   * Get all generated playlists
   */
  async getAllGeneratedPlaylists() {
    try {
      const playlists = await this.prisma.generatedPlaylist.findMany({
        orderBy: { createdAt: "desc" },
      });

      return playlists;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Generated Playlists Query");
      return [];
    }
  }

  /**
   * Delete generated playlist
   */
  async deleteGeneratedPlaylist(key) {
    try {
      const deleted = await this.prisma.generatedPlaylist.delete({
        where: { key },
      });

      console.log(chalk.green(`✅ Deleted playlist mapping: ${deleted.name}`));
      return deleted;
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Generated Playlist Deletion");
      throw error;
    }
  }

  /**
   * Store playlist tracks relationship
   */
  async storePlaylistTracks(playlistKey, trackIds) {
    try {
      // First, remove existing tracks for this playlist
      await this.prisma.playlistTrack.deleteMany({
        where: { playlistKey },
      });

      // Then add new tracks
      const playlistTracks = trackIds.map((trackId, index) => ({
        playlistKey,
        trackId,
        position: index,
        addedAt: new Date(),
      }));

      await this.prisma.playlistTrack.createMany({
        data: playlistTracks,
      });

      console.log(
        chalk.green(
          `✅ Stored ${trackIds.length} tracks for playlist ${playlistKey}`
        )
      );
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Playlist Tracks Storage");
      throw error;
    }
  }

  /**
   * Get tracks for a playlist
   */
  async getPlaylistTracks(playlistKey) {
    try {
      const playlistTracks = await this.prisma.playlistTrack.findMany({
        where: { playlistKey },
        include: {
          track: {
            include: {
              album: true,
              trackArtists: {
                include: {
                  artist: true,
                },
                orderBy: { position: "asc" },
              },
            },
          },
        },
        orderBy: { position: "asc" },
      });

      return playlistTracks.map((pt) => pt.track);
    } catch (error) {
      ErrorHandler.handleStorageError(error, "Playlist Tracks Query");
      return [];
    }
  }
}

module.exports = DatabaseService;
