/**
 * Database Service for Spotify Organizer
 *
 * Handles all SQLite operations for caching track data, genres, and audio features
 * Uses Prisma Client for type-safe database operations
 */

const { PrismaClient } = require("@prisma/client");
const chalk = require("chalk");
const ErrorHandler = require("../utils/errorHandler");

class DatabaseService {
  constructor() {
    this.prisma = new PrismaClient({
      log:
        process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
    });

    this.isConnected = false;
  }

  /**
   * Initialize database connection and run migrations
   */
  async initialize() {
    try {
      // Test connection
      await this.prisma.$connect();

      // Verify database schema by running a simple query
      await this.prisma.appConfig.findMany({ take: 1 });

      this.isConnected = true;
      console.log(chalk.green("✅ Database connected successfully"));

      return true;
    } catch (error) {
      console.log(chalk.red("❌ Database connection failed"));
      ErrorHandler.handleStorageError(error, "Database Initialization");
      return false;
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    try {
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
   * Store a batch of tracks from Spotify API response
   */
  async storeTracks(spotifyTracks, scanId = null) {
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
}

module.exports = DatabaseService;
