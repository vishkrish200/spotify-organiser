/**
 * Playlist Deletion Utility
 *
 * Handles Spotify Web API operations for deleting playlists created by the
 * organizer. Integrates with the authentication system and provides robust
 * error handling and progress tracking.
 */

const chalk = require("chalk");
const SpotifyAuth = require("./auth");

class PlaylistDeletion {
  constructor() {
    this.spotifyAuth = new SpotifyAuth();
    this.spotifyApi = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the playlist deletion utility
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      console.log(
        chalk.gray("🔐 Initializing Spotify authentication for deletion...")
      );

      // Authenticate and get Spotify API instance
      await this.spotifyAuth.authenticate();
      this.spotifyApi = this.spotifyAuth.getSpotifyApi();

      // Verify authentication
      const profile = await this.spotifyApi.getMe();
      console.log(
        chalk.gray(
          `✅ Authenticated as: ${profile.body.display_name || profile.body.id}`
        )
      );

      this.isInitialized = true;
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to initialize playlist deletion: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Delete a single playlist by ID
   */
  async deletePlaylist(playlistId, playlistName = null) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log(
        chalk.gray(`🗑️  Deleting playlist: ${playlistName || playlistId}`)
      );

      // Verify playlist exists and is owned by the user
      const playlistDetails = await this.verifyPlaylistOwnership(playlistId);

      if (!playlistDetails.canDelete) {
        throw new Error(playlistDetails.reason);
      }

      // Delete the playlist using Spotify API
      await this.spotifyApi.unfollowPlaylist(playlistId);

      console.log(
        chalk.green(`✅ Successfully deleted playlist: ${playlistDetails.name}`)
      );

      return {
        success: true,
        playlistId,
        playlistName: playlistDetails.name,
        trackCount: playlistDetails.trackCount,
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.error(
        chalk.red(`❌ Failed to delete playlist ${playlistId}: ${errorMessage}`)
      );

      return {
        success: false,
        playlistId,
        playlistName: playlistName || playlistId,
        error: errorMessage,
        retryable: this.isRetryableError(error),
      };
    }
  }

  /**
   * Delete multiple playlists with progress tracking
   */
  async deletePlaylists(playlists, options = {}) {
    const {
      maxRetries = 3,
      retryDelay = 2000,
      continueOnError = true,
      progressCallback = null,
    } = options;

    if (!this.isInitialized) {
      await this.initialize();
    }

    const results = {
      total: playlists.length,
      deleted: 0,
      failed: 0,
      results: [],
    };

    console.log(
      chalk.cyan(`🗑️  Starting deletion of ${playlists.length} playlists...`)
    );

    for (let i = 0; i < playlists.length; i++) {
      const playlist = playlists[i];
      const progress = (((i + 1) / playlists.length) * 100).toFixed(1);

      if (progressCallback) {
        progressCallback(i + 1, playlists.length, playlist);
      }

      console.log(
        chalk.gray(
          `[${i + 1}/${playlists.length}] (${progress}%) Processing: ${
            playlist.name || playlist.id
          }`
        )
      );

      let result = null;
      let attempt = 0;

      // Retry logic for individual playlist
      while (attempt < maxRetries) {
        attempt++;

        try {
          result = await this.deletePlaylist(playlist.id, playlist.name);

          if (result.success) {
            results.deleted++;
            break;
          } else if (!result.retryable || attempt >= maxRetries) {
            results.failed++;
            break;
          } else {
            console.log(
              chalk.yellow(
                `⚠️  Retrying playlist ${playlist.id} (attempt ${
                  attempt + 1
                }/${maxRetries})`
              )
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          }
        } catch (error) {
          result = {
            success: false,
            playlistId: playlist.id,
            playlistName: playlist.name || playlist.id,
            error: error.message,
            retryable: this.isRetryableError(error),
          };

          if (!result.retryable || attempt >= maxRetries) {
            results.failed++;
            break;
          } else {
            console.log(
              chalk.yellow(
                `⚠️  Retrying playlist ${playlist.id} due to error (attempt ${
                  attempt + 1
                }/${maxRetries})`
              )
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          }
        }
      }

      results.results.push({
        ...result,
        attempts: attempt,
      });

      // Stop if we hit a critical error and continueOnError is false
      if (!result.success && !continueOnError) {
        console.log(chalk.red("❌ Stopping deletion due to critical error"));
        break;
      }

      // Add small delay between deletions to be respectful to API
      if (i < playlists.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Summary
    console.log(chalk.cyan("\n📊 Deletion Summary:"));
    console.log(
      chalk.green(`✅ Successfully deleted: ${results.deleted} playlists`)
    );
    if (results.failed > 0) {
      console.log(
        chalk.red(`❌ Failed to delete: ${results.failed} playlists`)
      );
    }

    return results;
  }

  /**
   * Verify playlist ownership and deletion permissions
   */
  async verifyPlaylistOwnership(playlistId) {
    try {
      const playlist = await this.spotifyApi.getPlaylist(playlistId);
      const currentUser = await this.spotifyApi.getMe();

      const playlistData = playlist.body;
      const userData = currentUser.body;

      // Check if user owns the playlist
      const isOwner = playlistData.owner.id === userData.id;

      // Check if playlist is collaborative (affects deletion permissions)
      const isCollaborative = playlistData.collaborative;

      if (!isOwner) {
        return {
          canDelete: false,
          reason: `Cannot delete playlist '${playlistData.name}' - not owned by current user`,
          name: playlistData.name,
          ownerId: playlistData.owner.id,
        };
      }

      if (isCollaborative) {
        console.log(
          chalk.yellow(
            `⚠️  Playlist '${playlistData.name}' is collaborative - deletion will affect all collaborators`
          )
        );
      }

      return {
        canDelete: true,
        name: playlistData.name,
        trackCount: playlistData.tracks.total,
        isCollaborative,
        isPublic: playlistData.public,
        ownerId: playlistData.owner.id,
      };
    } catch (error) {
      if (error.statusCode === 404) {
        return {
          canDelete: false,
          reason: `Playlist ${playlistId} not found or not accessible`,
          name: playlistId,
        };
      }

      throw error;
    }
  }

  /**
   * Get playlists owned by the current user
   */
  async getUserPlaylists(limit = 50) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const currentUser = await this.spotifyApi.getMe();
      const userId = currentUser.body.id;

      let playlists = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const response = await this.spotifyApi.getUserPlaylists(userId, {
          limit: Math.min(limit, 50), // Spotify API limit is 50
          offset,
        });

        const items = response.body.items;
        playlists = playlists.concat(items);

        hasMore =
          items.length === Math.min(limit, 50) && playlists.length < limit;
        offset += items.length;
      }

      // Filter to only playlists owned by the user
      const ownedPlaylists = playlists.filter(
        (playlist) => playlist.owner.id === userId
      );

      return ownedPlaylists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        trackCount: playlist.tracks.total,
        isPublic: playlist.public,
        isCollaborative: playlist.collaborative,
        description: playlist.description,
        createdAt: playlist.external_urls?.spotify,
      }));
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to get user playlists: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Check if a playlist exists
   */
  async playlistExists(playlistId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      await this.spotifyApi.getPlaylist(playlistId);
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Extract meaningful error message from Spotify API error
   */
  getErrorMessage(error) {
    if (error.response && error.response.data) {
      if (error.response.data.error) {
        return error.response.data.error.message || error.response.data.error;
      }
    }

    if (error.statusCode) {
      switch (error.statusCode) {
        case 400:
          return "Bad request - invalid playlist ID or parameters";
        case 401:
          return "Unauthorized - authentication required";
        case 403:
          return "Forbidden - insufficient permissions to delete playlist";
        case 404:
          return "Playlist not found or not accessible";
        case 429:
          return "Rate limit exceeded - too many requests";
        case 500:
          return "Spotify server error - please try again later";
        default:
          return `HTTP ${error.statusCode}: ${error.message}`;
      }
    }

    return error.message || "Unknown error occurred";
  }

  /**
   * Determine if an error is retryable
   */
  isRetryableError(error) {
    if (error.statusCode) {
      // Retryable errors: rate limiting, server errors, temporary network issues
      return [429, 500, 502, 503, 504].includes(error.statusCode);
    }

    // Network errors are generally retryable
    return (
      error.code === "ECONNRESET" ||
      error.code === "ETIMEDOUT" ||
      error.code === "ENOTFOUND"
    );
  }

  /**
   * Create a playlist deletion progress tracker
   */
  createProgressTracker() {
    let lastProgress = 0;

    return (current, total, playlist) => {
      const progress = Math.floor((current / total) * 100);

      // Only update on significant progress changes to avoid spam
      if (progress >= lastProgress + 5 || current === total) {
        console.log(
          chalk.cyan(
            `📈 Progress: ${current}/${total} (${progress}%) - ${
              playlist.name || playlist.id
            }`
          )
        );
        lastProgress = progress;
      }
    };
  }

  /**
   * Cleanup and disconnect
   */
  async cleanup() {
    // No explicit cleanup needed for Spotify API
    this.isInitialized = false;
    console.log(chalk.gray("🧹 Playlist deletion utility cleaned up"));
  }
}

module.exports = PlaylistDeletion;
