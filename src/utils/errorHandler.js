/**
 * Comprehensive Error Handling Utility
 *
 * Provides robust error handling for authentication, storage, and network operations
 */

const chalk = require("chalk");

class ErrorHandler {
  /**
   * Handle authentication errors with user-friendly messages and recovery suggestions
   */
  static handleAuthError(error, context = "") {
    const errorInfo = {
      type: "authentication",
      originalError: error,
      context,
      handled: true,
      recoverySteps: [],
    };

    console.log(
      chalk.red(
        `\n❌ Authentication Error${context ? ` (${context})` : ""}: ${
          error.message
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

    console.log(chalk.gray(`\nDetailed error: ${error.message}`));
    return errorInfo;
  }

  /**
   * Handle storage errors with recovery strategies
   */
  static handleStorageError(error, operation, context = "") {
    const errorInfo = {
      type: "storage",
      operation,
      originalError: error,
      context,
      handled: true,
      recoverySteps: [],
    };

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
    console.log(chalk.gray(`Error details: ${error.message}`));
    return errorInfo;
  }

  /**
   * Handle network errors with retry strategies
   */
  static handleNetworkError(error, context = "", retryCount = 0) {
    const errorInfo = {
      type: "network",
      originalError: error,
      context,
      retryCount,
      handled: true,
      shouldRetry: retryCount < 3,
    };

    console.log(
      chalk.red(`\n❌ Network Error${context ? ` (${context})` : ""}`)
    );

    if (this.isTimeoutError(error)) {
      errorInfo.category = "timeout";
      console.log(chalk.yellow("⏱️ Request Timeout:"));
      console.log(chalk.white("• Spotify API is responding slowly"));
      console.log(chalk.white(`• Retry attempt ${retryCount + 1}/3`));
      if (errorInfo.shouldRetry) {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
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

    console.log(chalk.gray(`\nError details: ${error.message}`));
    return errorInfo;
  }

  /**
   * Handle environment/configuration errors
   */
  static handleConfigError(error, context = "") {
    console.log(
      chalk.red(
        `\n❌ Configuration Error${context ? ` (${context})` : ""}: ${
          error.message
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
   * Execute recovery strategy based on error info
   */
  static async executeRecovery(errorInfo, context) {
    const { recoverySteps } = errorInfo;

    for (const step of recoverySteps) {
      switch (step) {
        case "retry_after_delay":
          const delay = errorInfo.retryDelay || 2000;
          console.log(
            chalk.blue(`⏳ Waiting ${delay / 1000} seconds before retry...`)
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          break;
        case "fallback_to_file":
          console.log(
            chalk.blue("🔄 Attempting fallback to encrypted file storage...")
          );
          break;
        case "clear_tokens":
          console.log(
            chalk.blue("🧹 Consider clearing stored tokens if issues persist")
          );
          break;
        default:
          // Other recovery steps are informational
          break;
      }
    }

    return errorInfo;
  }
}

module.exports = ErrorHandler;
