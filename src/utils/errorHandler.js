/**
 * Comprehensive Error Handling Utility
 *
 * Provides robust error handling for authentication, storage, and network operations
 * Integrates with Winston logging, custom error classes, and error reporting
 */

const chalk = require("chalk");
const logger = require("./logger");
const errorReporter = require("./errorReporter");
const {
  SpotifyOrganizerError,
  AuthenticationError,
  StorageError,
  NetworkError,
  ConfigurationError,
  SpotifyAPIError,
  PlaylistError,
  DataProcessingError,
  ErrorFactory,
} = require("./customErrors");

class ErrorHandler {
  /**
   * Handle authentication errors with user-friendly messages and recovery suggestions
   */
  static handleAuthError(error, context = "") {
    let customError;
    let errorInfo = {
      type: "authentication",
      originalError: error,
      context,
      handled: true,
      recoverySteps: [],
    };

    // Create custom error or use existing one
    if (error instanceof AuthenticationError) {
      customError = error;
    } else {
      customError = ErrorFactory.fromHttpError(error, context);
      if (!(customError instanceof AuthenticationError)) {
        customError = new AuthenticationError(error.message, {
          context,
          innerError: error,
          authType: this.determineAuthType(error),
        });
      }
    }

    // Report the error
    const errorReport = errorReporter.reportError(customError, context, {
      component: "auth",
      operation: "authentication",
    });

    console.log(
      chalk.red(
        `\n❌ Authentication Error${context ? ` (${context})` : ""}: ${
          customError.message
        }`
      )
    );

    // Network-related errors
    if (this.isNetworkError(error)) {
      errorInfo.category = "network";
      console.log(chalk.yellow("🌐 Network Issue Detected:"));
      console.log(chalk.white("• Check your internet connection"));
      console.log(chalk.white("• Verify you can access spotify.com"));
      console.log(chalk.white("• Try again in a few moments"));
      errorInfo.recoverySteps.push("check_network", "retry_after_delay");
    }
    // Spotify API errors
    else if (this.isSpotifyAPIError(error)) {
      errorInfo.category = "spotify_api";
      this.handleSpotifyAPIError(error, errorInfo);
    }
    // OAuth flow errors
    else if (this.isOAuthError(error)) {
      errorInfo.category = "oauth";
      this.handleOAuthError(error, errorInfo);
    }
    // Token-related errors
    else if (this.isTokenError(error)) {
      errorInfo.category = "token";
      this.handleTokenError(error, errorInfo);
    }
    // Generic authentication errors
    else {
      errorInfo.category = "generic";
      console.log(chalk.yellow("💡 Troubleshooting Steps:"));
      console.log(
        chalk.white("• Verify your SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET")
      );
      console.log(
        chalk.white(
          "• Check your app settings at https://developer.spotify.com/dashboard"
        )
      );
      console.log(
        chalk.white("• Ensure your app has the required permissions")
      );
      errorInfo.recoverySteps.push("verify_credentials", "check_app_settings");
    }

    console.log(chalk.gray(`\nDetailed error: ${customError.message}`));

    // Add custom error and report to error info
    errorInfo.customError = customError;
    errorInfo.errorReport = errorReport;

    return errorInfo;
  }

  /**
   * Handle storage errors with recovery strategies
   */
  static handleStorageError(error, operation, context = "") {
    let customError;
    let errorInfo = {
      type: "storage",
      operation,
      originalError: error,
      context,
      handled: true,
      recoverySteps: [],
    };

    // Create custom error or use existing one
    if (error instanceof StorageError) {
      customError = error;
    } else if (this.isKeychainError(error)) {
      customError = ErrorFactory.fromKeychainError(error, operation);
    } else if (this.isFileSystemError(error)) {
      customError = ErrorFactory.fromFSError(error, operation, error.path);
    } else {
      customError = new StorageError(error.message, {
        operation,
        context,
        innerError: error,
        storageType: this.determineStorageType(error),
      });
    }

    // Report the error
    const errorReport = errorReporter.reportError(customError, context, {
      component: "storage",
      operation,
    });

    console.log(
      chalk.red(
        `\n❌ Storage Error${
          context ? ` (${context})` : ""
        }: ${operation} failed`
      )
    );

    // Keychain/keytar errors
    if (this.isKeychainError(error)) {
      errorInfo.category = "keychain";
      console.log(chalk.yellow("🔐 Keychain Issue:"));
      console.log(
        chalk.white("• System keychain may be locked or inaccessible")
      );
      console.log(chalk.white("• Falling back to encrypted file storage"));
      console.log(chalk.white("• Consider unlocking your system keychain"));
      errorInfo.recoverySteps.push("fallback_to_file", "unlock_keychain");
    }
    // File system errors
    else if (this.isFileSystemError(error)) {
      errorInfo.category = "filesystem";
      console.log(chalk.yellow("📁 File System Issue:"));
      console.log(
        chalk.white("• Check permissions on ~/.spotify-organizer directory")
      );
      console.log(chalk.white("• Ensure sufficient disk space"));
      console.log(chalk.white("• Verify directory is writable"));
      errorInfo.recoverySteps.push("check_permissions", "check_disk_space");
    }
    // Encryption/decryption errors
    else if (this.isEncryptionError(error)) {
      errorInfo.category = "encryption";
      console.log(chalk.yellow("🔒 Encryption Issue:"));
      console.log(chalk.white("• Token data may be corrupted"));
      console.log(chalk.white("• Re-authentication may be required"));
      console.log(chalk.white("• Consider clearing stored credentials"));
      errorInfo.recoverySteps.push("clear_tokens", "reauthenticate");
    }
    // Generic storage errors
    else {
      errorInfo.category = "generic";
      console.log(chalk.yellow("💾 Storage system experiencing issues"));
      console.log(
        chalk.white("• Try clearing stored tokens and re-authenticating")
      );
      errorInfo.recoverySteps.push("clear_tokens", "reauthenticate");
    }

    console.log(chalk.gray(`\nOperation: ${operation}`));
    console.log(chalk.gray(`Error details: ${customError.message}`));

    errorInfo.customError = customError;
    errorInfo.errorReport = errorReport;
    return errorInfo;
  }

  /**
   * Handle network errors with retry strategies
   */
  static handleNetworkError(error, context = "", retryCount = 0) {
    let customError;
    let errorInfo = {
      type: "network",
      originalError: error,
      context,
      retryCount,
      handled: true,
      shouldRetry: retryCount < 3,
    };

    // Create custom error or use existing one
    if (error instanceof NetworkError) {
      customError = error;
    } else {
      customError = ErrorFactory.fromHttpError(error, context);
      if (!(customError instanceof NetworkError)) {
        customError = new NetworkError(error.message, {
          context,
          innerError: error,
          networkType: this.determineNetworkType(error),
          retryCount,
          maxRetries: 3,
        });
      }
    }

    // Report the error
    const errorReport = errorReporter.reportError(customError, context, {
      component: "network",
      operation: "request",
      retryCount,
    });

    console.log(
      chalk.red(`\n❌ Network Error${context ? ` (${context})` : ""}`)
    );

    if (this.isTimeoutError(error)) {
      errorInfo.category = "timeout";
      console.log(chalk.yellow("⏱️ Request Timeout:"));
      console.log(chalk.white("• Spotify API is responding slowly"));
      console.log(chalk.white(`• Retry attempt ${retryCount + 1}/3`));
      if (errorInfo.shouldRetry) {
        const delay = customError.getRetryDelay();
        console.log(chalk.white(`• Retrying in ${delay / 1000} seconds...`));
        errorInfo.retryDelay = delay;
      }
    } else if (this.isConnectionError(error)) {
      errorInfo.category = "connection";
      console.log(chalk.yellow("🌐 Connection Issue:"));
      console.log(chalk.white("• Cannot reach Spotify servers"));
      console.log(chalk.white("• Check your internet connection"));
      console.log(chalk.white("• Verify firewall/proxy settings"));
    } else {
      errorInfo.category = "generic";
      console.log(chalk.yellow("🌐 Network request failed"));
      console.log(chalk.white("• Check your internet connection"));
      console.log(chalk.white("• Try again in a few moments"));
    }

    console.log(chalk.gray(`\nError details: ${customError.message}`));

    errorInfo.customError = customError;
    errorInfo.errorReport = errorReport;
    return errorInfo;
  }

  /**
   * Handle environment/configuration errors
   */
  static handleConfigError(error, context = "") {
    let customError;

    if (error instanceof ConfigurationError) {
      customError = error;
    } else {
      customError = new ConfigurationError(error.message, {
        context,
        innerError: error,
        configType: this.determineConfigType(error),
      });
    }

    // Report the error
    const errorReport = errorReporter.reportError(customError, context, {
      component: "config",
      operation: "configuration",
    });

    console.log(
      chalk.red(
        `\n❌ Configuration Error${context ? ` (${context})` : ""}: ${
          customError.message
        }`
      )
    );
    console.log(chalk.yellow("⚙️ Configuration Issues:"));
    console.log(
      chalk.white(
        "• Check your .env file exists and has the required variables"
      )
    );
    console.log(
      chalk.white(
        "• Verify SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set"
      )
    );
    console.log(
      chalk.white("• Ensure no extra spaces or quotes in environment variables")
    );
    console.log(
      chalk.cyan(
        "\nGet credentials from: https://developer.spotify.com/dashboard"
      )
    );

    return {
      type: "configuration",
      originalError: error,
      context,
      handled: true,
      recoverySteps: ["check_env_file", "verify_credentials", "check_format"],
      customError,
      errorReport,
    };
  }

  /**
   * Handle playlist operation errors
   */
  static handlePlaylistError(
    error,
    operation,
    playlistInfo = {},
    context = ""
  ) {
    let customError;

    if (error instanceof PlaylistError) {
      customError = error;
    } else {
      customError = new PlaylistError(error.message, {
        context,
        innerError: error,
        operation,
        playlistId: playlistInfo.id,
        playlistName: playlistInfo.name,
        trackCount: playlistInfo.trackCount,
      });
    }

    // Report the error
    const errorReport = errorReporter.reportError(customError, context, {
      component: "playlist",
      operation,
      playlistId: playlistInfo.id,
      playlistName: playlistInfo.name,
    });

    console.log(
      chalk.red(
        `\n❌ Playlist Error${
          context ? ` (${context})` : ""
        }: ${operation} failed`
      )
    );

    if (customError.isCreationError()) {
      console.log(chalk.yellow("📋 Playlist Creation Issue:"));
      console.log(chalk.white("• Check your Spotify permissions"));
      console.log(chalk.white("• Verify playlist name is valid"));
    } else if (customError.isTrackError()) {
      console.log(chalk.yellow("🎵 Track Addition Issue:"));
      console.log(chalk.white("• Some tracks may be unavailable"));
      console.log(chalk.white("• Check track URIs are valid"));
    }

    return {
      type: "playlist",
      operation,
      originalError: error,
      context,
      handled: true,
      customError,
      errorReport,
    };
  }

  /**
   * Handle data processing errors
   */
  static handleDataProcessingError(
    error,
    dataType,
    processingStage,
    context = ""
  ) {
    let customError;

    if (error instanceof DataProcessingError) {
      customError = error;
    } else {
      customError = new DataProcessingError(error.message, {
        context,
        innerError: error,
        dataType,
        processingStage,
      });
    }

    // Report the error
    const errorReport = errorReporter.reportError(customError, context, {
      component: "data_processing",
      operation: processingStage,
      dataType,
    });

    console.log(
      chalk.red(
        `\n❌ Data Processing Error${
          context ? ` (${context})` : ""
        }: ${processingStage} failed`
      )
    );

    if (customError.isCategorizationError()) {
      console.log(chalk.yellow("🏷️ Categorization Issue:"));
      console.log(chalk.white("• Music categorization failed for some tracks"));
      console.log(chalk.white("• Check track metadata quality"));
    }

    return {
      type: "data_processing",
      operation: processingStage,
      originalError: error,
      context,
      handled: true,
      customError,
      errorReport,
    };
  }

  // =====================================
  // Error Detection Methods
  // =====================================

  static isNetworkError(error) {
    const networkErrorCodes = [
      "ENOTFOUND",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ECONNRESET",
    ];
    const networkErrorMessages = ["network", "timeout", "connection", "dns"];

    return (
      networkErrorCodes.some((code) => error.code === code) ||
      networkErrorMessages.some((msg) =>
        error.message.toLowerCase().includes(msg)
      ) ||
      (error.response && error.response.status >= 500)
    );
  }

  static isSpotifyAPIError(error) {
    return (
      error.response &&
      error.response.config &&
      error.response.config.url &&
      error.response.config.url.includes("spotify.com")
    );
  }

  static isOAuthError(error) {
    const oauthErrors = [
      "authorization_pending",
      "slow_down",
      "expired_token",
      "access_denied",
      "invalid_client",
      "invalid_grant",
      "unsupported_grant_type",
    ];

    return (
      oauthErrors.some((oauthError) => error.message.includes(oauthError)) ||
      (error.response &&
        error.response.data &&
        oauthErrors.includes(error.response.data.error))
    );
  }

  static isTokenError(error) {
    const tokenErrorMessages = [
      "token",
      "expired",
      "invalid",
      "refresh",
      "unauthorized",
    ];
    return (
      tokenErrorMessages.some((msg) =>
        error.message.toLowerCase().includes(msg)
      ) ||
      (error.response && error.response.status === 401)
    );
  }

  static isKeychainError(error) {
    const keychainMessages = ["keychain", "keytar", "credential", "access"];
    return keychainMessages.some((msg) =>
      error.message.toLowerCase().includes(msg)
    );
  }

  static isFileSystemError(error) {
    const fsErrorCodes = ["ENOENT", "EACCES", "EPERM", "ENOSPC"];
    return fsErrorCodes.some((code) => error.code === code);
  }

  static isEncryptionError(error) {
    const encryptionMessages = [
      "decrypt",
      "encrypt",
      "cipher",
      "tag",
      "authentication",
    ];
    return encryptionMessages.some((msg) =>
      error.message.toLowerCase().includes(msg)
    );
  }

  static isTimeoutError(error) {
    return (
      error.code === "ETIMEDOUT" ||
      error.message.includes("timeout") ||
      (error.response && error.response.status === 408)
    );
  }

  static isConnectionError(error) {
    return (
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
      error.code === "ECONNRESET"
    );
  }

  // =====================================
  // Helper Methods for Error Classification
  // =====================================

  static determineAuthType(error) {
    if (this.isOAuthError(error)) return "oauth";
    if (this.isTokenError(error)) return "token";
    if (error.response && [400, 401, 403].includes(error.response.status))
      return "credentials";
    return "unknown";
  }

  static determineStorageType(error) {
    if (this.isKeychainError(error)) return "keychain";
    if (this.isFileSystemError(error)) return "filesystem";
    if (this.isEncryptionError(error)) return "encryption";
    return "unknown";
  }

  static determineNetworkType(error) {
    if (this.isTimeoutError(error)) return "timeout";
    if (this.isConnectionError(error)) return "connection";
    if (error.code === "ENOTFOUND") return "dns";
    return "unknown";
  }

  static determineConfigType(error) {
    if (error.message.includes("env")) return "env";
    if (error.message.includes("credential")) return "credentials";
    return "unknown";
  }

  // =====================================
  // Specific Error Handlers
  // =====================================

  static handleSpotifyAPIError(error, errorInfo) {
    const status = error.response ? error.response.status : 0;

    switch (status) {
      case 400:
        console.log(chalk.yellow("🔑 Bad Request:"));
        console.log(chalk.white("• Check your client credentials"));
        console.log(chalk.white("• Verify request parameters"));
        errorInfo.recoverySteps.push("verify_credentials", "check_parameters");
        break;
      case 401:
        console.log(chalk.yellow("🚫 Unauthorized:"));
        console.log(chalk.white("• Your token may be expired or invalid"));
        console.log(chalk.white("• Re-authentication required"));
        errorInfo.recoverySteps.push("reauthenticate");
        break;
      case 403:
        console.log(chalk.yellow("⛔ Forbidden:"));
        console.log(chalk.white("• Your app may lack required permissions"));
        console.log(chalk.white("• Check app settings in Spotify Dashboard"));
        errorInfo.recoverySteps.push("check_app_permissions");
        break;
      case 429:
        console.log(chalk.yellow("⏳ Rate Limited:"));
        console.log(chalk.white("• Too many requests to Spotify API"));
        console.log(chalk.white("• Wait before retrying"));
        errorInfo.recoverySteps.push("wait_rate_limit");
        break;
      default:
        console.log(chalk.yellow(`🌐 Spotify API Error (${status}):`));
        console.log(chalk.white("• Temporary issue with Spotify services"));
        console.log(chalk.white("• Try again in a few moments"));
        errorInfo.recoverySteps.push("retry_after_delay");
    }
  }

  static handleOAuthError(error, errorInfo) {
    const errorType = error.response?.data?.error || error.message;

    switch (errorType) {
      case "authorization_pending":
        // This is normal during polling - not really an error
        errorInfo.handled = false;
        break;
      case "slow_down":
        console.log(chalk.yellow("⏳ Slowing down polling as requested"));
        errorInfo.recoverySteps.push("slow_down");
        break;
      case "expired_token":
        console.log(chalk.yellow("⏰ Device code expired:"));
        console.log(chalk.white("• Please start authentication again"));
        errorInfo.recoverySteps.push("restart_auth");
        break;
      case "access_denied":
        console.log(chalk.yellow("🚫 Authorization denied:"));
        console.log(chalk.white("• User declined authorization"));
        console.log(chalk.white("• Authorization is required to proceed"));
        errorInfo.recoverySteps.push("user_retry");
        break;
      default:
        console.log(chalk.yellow("🔐 OAuth flow error:"));
        console.log(chalk.white("• Authentication process failed"));
        console.log(chalk.white("• Try starting authentication again"));
        errorInfo.recoverySteps.push("restart_auth");
    }
  }

  static handleTokenError(error, errorInfo) {
    console.log(chalk.yellow("🎫 Token Issue:"));
    console.log(chalk.white("• Access token may be expired or invalid"));
    console.log(chalk.white("• Attempting automatic token refresh..."));
    errorInfo.recoverySteps.push("refresh_token", "reauthenticate");
  }

  /**
   * Handle generic errors with basic troubleshooting
   */
  static handleGenericError(error, context = "") {
    let customError;
    let errorInfo = {
      type: "generic",
      originalError: error,
      context,
      handled: true,
      recoverySteps: ["check_logs", "retry_operation"],
    };

    // Create appropriate custom error
    if (this.isNetworkError(error)) {
      return this.handleNetworkError(error, context);
    } else if (this.isSpotifyAPIError(error)) {
      customError = ErrorFactory.fromHttpError(error, context);
      errorInfo.category = "spotify_api";
      this.handleSpotifyAPIError(error, errorInfo);
    } else if (this.isConfigError(error)) {
      return this.handleConfigError(error, context);
    } else {
      customError = new SpotifyOrganizerError(error.message, {
        context,
        innerError: error,
        category: "unknown",
      });
      errorInfo.category = "unknown";
      console.log(chalk.yellow("💡 General Troubleshooting:"));
      console.log(chalk.white("• Check system logs for more details"));
      console.log(chalk.white("• Verify all dependencies are installed"));
      console.log(chalk.white("• Try restarting the application"));
      errorInfo.recoverySteps.push("check_dependencies", "restart_app");
    }

    // Report the error
    const errorReport = errorReporter.reportError(customError, context, {
      component: "general",
      operation: "unknown",
    });

    console.log(
      chalk.red(
        `\n❌ Error${context ? ` (${context})` : ""}: ${customError.message}`
      )
    );

    console.log(chalk.gray(`\nDetailed error: ${customError.message}`));
    if (error.stack) {
      console.log(chalk.gray(`Stack trace: ${error.stack}`));
    }

    errorInfo.customError = customError;
    errorInfo.errorReport = errorReport;
    return errorInfo;
  }

  /**
   * Check if error is a configuration error
   */
  static isConfigError(error) {
    const configMessages = ["config", "environment", "missing", "undefined"];
    return configMessages.some((msg) =>
      error.message.toLowerCase().includes(msg)
    );
  }

  /**
   * Execute recovery strategy based on error info
   */
  static async executeRecovery(errorInfo, context) {
    const { recoverySteps } = errorInfo;

    logger.info("Executing error recovery strategy", {
      component: "recovery",
      operation: "execute_recovery",
      recoverySteps,
      context,
      errorReportId: errorInfo.errorReport?.id,
    });

    for (const step of recoverySteps) {
      switch (step) {
        case "retry_after_delay":
          const delay = errorInfo.retryDelay || 2000;
          console.log(
            chalk.blue(`⏳ Waiting ${delay / 1000} seconds before retry...`)
          );
          logger.info(`Waiting ${delay}ms before retry`, {
            component: "recovery",
            operation: "delay",
            delay,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
          break;
        case "fallback_to_file":
          console.log(
            chalk.blue("🔄 Attempting fallback to encrypted file storage...")
          );
          logger.info("Attempting fallback storage mechanism", {
            component: "recovery",
            operation: "fallback_storage",
          });
          break;
        case "clear_tokens":
          console.log(
            chalk.blue("🧹 Consider clearing stored tokens if issues persist")
          );
          logger.info("Suggesting token cleanup", {
            component: "recovery",
            operation: "suggest_token_cleanup",
          });
          break;
        default:
          // Other recovery steps are informational
          logger.debug(`Recovery step: ${step}`, {
            component: "recovery",
            operation: "informational_step",
            step,
          });
          break;
      }
    }

    return errorInfo;
  }

  /**
   * Create error-specific logger
   */
  static createErrorLogger(component) {
    return logger.child({ component });
  }

  /**
   * Get error statistics from error reporter
   */
  static getErrorStats(days = 7) {
    return errorReporter.getErrorStats(days);
  }

  /**
   * Flush all pending error reports
   */
  static flushErrorReports() {
    return errorReporter.flush();
  }
}

module.exports = ErrorHandler;
