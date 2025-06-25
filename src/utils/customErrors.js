/**
 * Custom Error Classes for Spotify Organizer
 *
 * Provides standardized error hierarchy with detailed error information
 * and proper error classification for programmatic handling
 */

/**
 * Base custom error class for all Spotify Organizer errors
 */
class SpotifyOrganizerError extends Error {
  constructor(message, options = {}) {
    super(message);

    // Set the error name to the class name
    this.name = this.constructor.name;

    // Maintain proper stack trace for debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Additional properties for programmatic handling
    this.errorCode = options.errorCode || "GENERAL_ERROR";
    this.context = options.context || "";
    this.innerError = options.innerError || null;
    this.recoverySteps = options.recoverySteps || [];
    this.category = options.category || "general";
    this.timestamp = new Date().toISOString();
    this.shouldRetry =
      options.shouldRetry !== undefined ? options.shouldRetry : false;
    this.userMessage = options.userMessage || message;

    // Additional metadata for logging and debugging
    this.metadata = {
      severity: options.severity || "error",
      component: options.component || "unknown",
      operation: options.operation || "unknown",
      ...options.metadata,
    };
  }

  /**
   * Get a JSON representation of the error for logging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      errorCode: this.errorCode,
      context: this.context,
      category: this.category,
      timestamp: this.timestamp,
      shouldRetry: this.shouldRetry,
      userMessage: this.userMessage,
      metadata: this.metadata,
      stack: this.stack,
      innerError: this.innerError
        ? {
            name: this.innerError.name,
            message: this.innerError.message,
            stack: this.innerError.stack,
          }
        : null,
    };
  }

  /**
   * Get user-friendly error description
   */
  getUserFriendlyMessage() {
    return this.userMessage;
  }

  /**
   * Check if this error should trigger a retry
   */
  isRetryable() {
    return this.shouldRetry;
  }
}

/**
 * Authentication-related errors
 */
class AuthenticationError extends SpotifyOrganizerError {
  constructor(message, options = {}) {
    super(message, {
      errorCode: "AUTH_ERROR",
      category: "authentication",
      component: "auth",
      severity: "error",
      ...options,
    });

    this.authType = options.authType || "unknown"; // 'oauth', 'token', 'credentials'
    this.statusCode = options.statusCode || null;
    this.retryAfter = options.retryAfter || null;
  }

  /**
   * Check if this is a token-related error
   */
  isTokenError() {
    return this.authType === "token" || this.errorCode === "TOKEN_EXPIRED";
  }

  /**
   * Check if this is an OAuth flow error
   */
  isOAuthError() {
    return this.authType === "oauth";
  }
}

/**
 * Storage-related errors (filesystem, keychain, etc.)
 */
class StorageError extends SpotifyOrganizerError {
  constructor(message, options = {}) {
    super(message, {
      errorCode: "STORAGE_ERROR",
      category: "storage",
      component: "storage",
      severity: "error",
      ...options,
    });

    this.storageType = options.storageType || "unknown"; // 'keychain', 'filesystem', 'encryption'
    this.operation = options.operation || "unknown"; // 'read', 'write', 'delete'
    this.filePath = options.filePath || null;
    this.fsError = options.fsError || null;
  }

  /**
   * Check if this is a keychain-related error
   */
  isKeychainError() {
    return this.storageType === "keychain";
  }

  /**
   * Check if this is a filesystem permission error
   */
  isPermissionError() {
    return this.fsError && ["EACCES", "EPERM"].includes(this.fsError.code);
  }

  /**
   * Check if fallback storage should be attempted
   */
  shouldFallback() {
    return this.storageType === "keychain" || this.isPermissionError();
  }
}

/**
 * Network-related errors
 */
class NetworkError extends SpotifyOrganizerError {
  constructor(message, options = {}) {
    super(message, {
      errorCode: "NETWORK_ERROR",
      category: "network",
      component: "network",
      severity: "warning",
      shouldRetry: true,
      ...options,
    });

    this.networkType = options.networkType || "unknown"; // 'timeout', 'connection', 'dns', 'proxy'
    this.statusCode = options.statusCode || null;
    this.retryAfter = options.retryAfter || null;
    this.endpoint = options.endpoint || null;
    this.retryCount = options.retryCount || 0;
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Check if this is a timeout error
   */
  isTimeout() {
    return this.networkType === "timeout";
  }

  /**
   * Check if this is a connection error
   */
  isConnectionError() {
    return this.networkType === "connection";
  }

  /**
   * Check if this is a rate limiting error
   */
  isRateLimited() {
    return this.statusCode === 429;
  }

  /**
   * Check if more retries are available
   */
  canRetry() {
    return this.shouldRetry && this.retryCount < this.maxRetries;
  }

  /**
   * Get next retry delay (in milliseconds)
   */
  getRetryDelay() {
    if (this.retryAfter) {
      return this.retryAfter * 1000;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s...
    const baseDelay = 1000;
    const maxDelay = 10000;
    return Math.min(baseDelay * Math.pow(2, this.retryCount), maxDelay);
  }
}

/**
 * Configuration-related errors
 */
class ConfigurationError extends SpotifyOrganizerError {
  constructor(message, options = {}) {
    super(message, {
      errorCode: "CONFIG_ERROR",
      category: "configuration",
      component: "config",
      severity: "error",
      shouldRetry: false,
      ...options,
    });

    this.configType = options.configType || "unknown"; // 'env', 'credentials', 'settings'
    this.missingKeys = options.missingKeys || [];
    this.invalidKeys = options.invalidKeys || [];
  }

  /**
   * Check if this is an environment variable error
   */
  isEnvironmentError() {
    return this.configType === "env";
  }

  /**
   * Check if this is a credentials error
   */
  isCredentialsError() {
    return this.configType === "credentials";
  }

  /**
   * Get list of missing configuration keys
   */
  getMissingKeys() {
    return this.missingKeys;
  }

  /**
   * Get list of invalid configuration keys
   */
  getInvalidKeys() {
    return this.invalidKeys;
  }
}

/**
 * Spotify API-specific errors
 */
class SpotifyAPIError extends SpotifyOrganizerError {
  constructor(message, options = {}) {
    super(message, {
      errorCode: "SPOTIFY_API_ERROR",
      category: "spotify_api",
      component: "spotify",
      severity: "error",
      ...options,
    });

    this.statusCode = options.statusCode || null;
    this.spotifyErrorCode = options.spotifyErrorCode || null;
    this.retryAfter = options.retryAfter || null;
    this.endpoint = options.endpoint || null;
    this.rateLimited = options.statusCode === 429;

    // Set retry behavior based on status code
    this.shouldRetry = this.isRetryableStatus(options.statusCode);
  }

  /**
   * Determine if a status code is retryable
   */
  isRetryableStatus(statusCode) {
    if (!statusCode) return false;

    // Retry on server errors and rate limiting
    return statusCode >= 500 || statusCode === 429;
  }

  /**
   * Check if this is a rate limiting error
   */
  isRateLimited() {
    return this.rateLimited;
  }

  /**
   * Check if this is an authorization error
   */
  isAuthorizationError() {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  /**
   * Check if this is a bad request error
   */
  isBadRequest() {
    return this.statusCode === 400;
  }

  /**
   * Get retry delay for rate limited requests
   */
  getRateLimitDelay() {
    if (this.retryAfter) {
      return this.retryAfter * 1000;
    }

    // Default to 60 seconds if no retry-after header
    return 60000;
  }
}

/**
 * Playlist operation errors
 */
class PlaylistError extends SpotifyOrganizerError {
  constructor(message, options = {}) {
    super(message, {
      errorCode: "PLAYLIST_ERROR",
      category: "playlist",
      component: "playlist",
      severity: "error",
      ...options,
    });

    this.playlistId = options.playlistId || null;
    this.playlistName = options.playlistName || null;
    this.operation = options.operation || "unknown"; // 'create', 'update', 'delete', 'add_tracks'
    this.trackCount = options.trackCount || null;
  }

  /**
   * Check if this is a playlist creation error
   */
  isCreationError() {
    return this.operation === "create";
  }

  /**
   * Check if this is a track addition error
   */
  isTrackError() {
    return this.operation === "add_tracks";
  }
}

/**
 * Data processing errors
 */
class DataProcessingError extends SpotifyOrganizerError {
  constructor(message, options = {}) {
    super(message, {
      errorCode: "DATA_PROCESSING_ERROR",
      category: "data_processing",
      component: "processor",
      severity: "error",
      ...options,
    });

    this.dataType = options.dataType || "unknown"; // 'tracks', 'playlists', 'user_data'
    this.processingStage = options.processingStage || "unknown"; // 'fetch', 'categorize', 'organize'
    this.itemCount = options.itemCount || null;
    this.failedItems = options.failedItems || [];
  }

  /**
   * Check if this is a categorization error
   */
  isCategorizationError() {
    return this.processingStage === "categorize";
  }

  /**
   * Get count of failed items
   */
  getFailedItemCount() {
    return this.failedItems.length;
  }
}

/**
 * Error factory for creating appropriate error instances
 */
class ErrorFactory {
  /**
   * Create an error based on error type and context
   */
  static createError(type, message, options = {}) {
    switch (type) {
      case "authentication":
      case "auth":
        return new AuthenticationError(message, options);

      case "storage":
        return new StorageError(message, options);

      case "network":
        return new NetworkError(message, options);

      case "configuration":
      case "config":
        return new ConfigurationError(message, options);

      case "spotify_api":
      case "spotify":
        return new SpotifyAPIError(message, options);

      case "playlist":
        return new PlaylistError(message, options);

      case "data_processing":
      case "processing":
        return new DataProcessingError(message, options);

      default:
        return new SpotifyOrganizerError(message, options);
    }
  }

  /**
   * Create error from HTTP response
   */
  static fromHttpError(error, context = "") {
    const statusCode = error.response?.status;
    const endpoint = error.config?.url;

    if (endpoint && endpoint.includes("spotify.com")) {
      return new SpotifyAPIError(error.message, {
        statusCode,
        endpoint,
        context,
        innerError: error,
        spotifyErrorCode: error.response?.data?.error,
      });
    }

    return new NetworkError(error.message, {
      statusCode,
      endpoint,
      context,
      innerError: error,
      networkType: this.determineNetworkType(error),
    });
  }

  /**
   * Create error from filesystem error
   */
  static fromFSError(error, operation, filePath) {
    return new StorageError(error.message, {
      operation,
      filePath,
      fsError: error,
      storageType: "filesystem",
      innerError: error,
      errorCode: error.code,
    });
  }

  /**
   * Create error from keychain error
   */
  static fromKeychainError(error, operation) {
    return new StorageError(error.message, {
      operation,
      storageType: "keychain",
      innerError: error,
      shouldRetry: true,
      recoverySteps: ["fallback_to_file", "unlock_keychain"],
    });
  }

  /**
   * Determine network error type from error object
   */
  static determineNetworkType(error) {
    if (error.code === "ETIMEDOUT" || error.message.includes("timeout")) {
      return "timeout";
    }

    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      return "connection";
    }

    if (error.code === "ECONNRESET") {
      return "connection";
    }

    return "unknown";
  }
}

module.exports = {
  SpotifyOrganizerError,
  AuthenticationError,
  StorageError,
  NetworkError,
  ConfigurationError,
  SpotifyAPIError,
  PlaylistError,
  DataProcessingError,
  ErrorFactory,
};
