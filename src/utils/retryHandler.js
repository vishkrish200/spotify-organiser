/**
 * Retry Handler Utility
 *
 * Provides robust retry mechanisms with exponential backoff for network operations
 */

const chalk = require("chalk");
const ErrorHandler = require("./errorHandler");

class RetryHandler {
  /**
   * Execute an operation with retry logic and exponential backoff
   */
  static async withRetry(operation, options = {}, context = "") {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 10000,
      exponential = true,
      retryCondition = RetryHandler.defaultRetryCondition,
      onRetry = null,
    } = options;

    let lastError;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const result = await operation();

        if (attempt > 0) {
          console.log(
            chalk.green(`✅ Operation succeeded after ${attempt} retries`)
          );
        }

        return result;
      } catch (error) {
        lastError = error;
        attempt++;

        // Check if we should retry this error
        if (!retryCondition(error, attempt, maxRetries)) {
          throw error;
        }

        // Don't retry if we've exceeded max attempts
        if (attempt > maxRetries) {
          break;
        }

        // Handle the error and get retry info
        const errorInfo = ErrorHandler.handleNetworkError(
          error,
          context,
          attempt - 1
        );

        // Calculate delay
        const delay = RetryHandler.calculateDelay(
          attempt - 1,
          baseDelay,
          maxDelay,
          exponential
        );

        console.log(
          chalk.yellow(
            `🔄 Retry ${attempt}/${maxRetries} in ${delay / 1000}s...`
          )
        );

        // Call custom retry callback if provided
        if (onRetry) {
          await onRetry(error, attempt, delay);
        }

        // Wait before retrying
        await RetryHandler.delay(delay);
      }
    }

    // All retries exhausted
    console.log(chalk.red(`❌ Operation failed after ${maxRetries} retries`));
    throw lastError;
  }

  /**
   * Retry specifically for authentication operations
   */
  static async retryAuth(operation, context = "") {
    return this.withRetry(
      operation,
      {
        maxRetries: 2,
        baseDelay: 2000,
        retryCondition: RetryHandler.authRetryCondition,
        onRetry: async (error, attempt, delay) => {
          console.log(
            chalk.blue(`🔐 Retrying authentication (attempt ${attempt})...`)
          );
        },
      },
      context
    );
  }

  /**
   * Retry for network/API operations with longer delays
   */
  static async retryNetworkOperation(operation, context = "") {
    return this.withRetry(
      operation,
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 8000,
        retryCondition: RetryHandler.networkRetryCondition,
        onRetry: async (error, attempt, delay) => {
          console.log(
            chalk.blue(`🌐 Retrying network operation (attempt ${attempt})...`)
          );
        },
      },
      context
    );
  }

  /**
   * Retry for storage operations with fallback mechanisms
   */
  static async retryStorageOperation(
    operation,
    fallbackOperation = null,
    context = ""
  ) {
    try {
      return await this.withRetry(
        operation,
        {
          maxRetries: 2,
          baseDelay: 500,
          retryCondition: RetryHandler.storageRetryCondition,
        },
        context
      );
    } catch (error) {
      // If primary storage fails and fallback is available
      if (fallbackOperation) {
        console.log(
          chalk.yellow("🔄 Primary storage failed, trying fallback...")
        );

        try {
          return await fallbackOperation();
        } catch (fallbackError) {
          console.log(chalk.red("❌ Both primary and fallback storage failed"));
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  // =====================================
  // Retry Condition Functions
  // =====================================

  /**
   * Default retry condition - retry on network/temporary errors
   */
  static defaultRetryCondition(error, attempt, maxRetries) {
    // Don't retry if we've hit max attempts
    if (attempt > maxRetries) {
      return false;
    }

    // Retry on network errors
    if (ErrorHandler.isNetworkError(error)) {
      return true;
    }

    // Retry on timeout errors
    if (ErrorHandler.isTimeoutError(error)) {
      return true;
    }

    // Retry on 5xx server errors
    if (error.response && error.response.status >= 500) {
      return true;
    }

    // Retry on rate limiting (429)
    if (error.response && error.response.status === 429) {
      return true;
    }

    // Don't retry on other errors
    return false;
  }

  /**
   * Authentication-specific retry condition
   */
  static authRetryCondition(error, attempt, maxRetries) {
    if (attempt > maxRetries) {
      return false;
    }

    // Retry on network errors
    if (ErrorHandler.isNetworkError(error)) {
      return true;
    }

    // Retry on temporary server errors
    if (error.response && error.response.status >= 500) {
      return true;
    }

    // Don't retry on OAuth errors (user needs to take action)
    if (ErrorHandler.isOAuthError(error)) {
      const oauthError = error.response?.data?.error;

      // Only retry on slow_down
      if (oauthError === "slow_down") {
        return true;
      }

      // Don't retry on user actions (expired, denied, etc.)
      return false;
    }

    // Don't retry on credential errors
    if (error.response && [400, 401, 403].includes(error.response.status)) {
      return false;
    }

    return RetryHandler.defaultRetryCondition(error, attempt, maxRetries);
  }

  /**
   * Network operation retry condition
   */
  static networkRetryCondition(error, attempt, maxRetries) {
    if (attempt > maxRetries) {
      return false;
    }

    // Retry on all network errors
    if (ErrorHandler.isNetworkError(error)) {
      return true;
    }

    // Retry on timeouts
    if (ErrorHandler.isTimeoutError(error)) {
      return true;
    }

    // Retry on server errors
    if (error.response && error.response.status >= 500) {
      return true;
    }

    // Retry on rate limiting with longer delay
    if (error.response && error.response.status === 429) {
      return true;
    }

    return false;
  }

  /**
   * Storage operation retry condition
   */
  static storageRetryCondition(error, attempt, maxRetries) {
    if (attempt > maxRetries) {
      return false;
    }

    // Retry on file system errors that might be temporary
    if (ErrorHandler.isFileSystemError(error)) {
      // Don't retry on permission errors (likely permanent)
      if (error.code === "EACCES" || error.code === "EPERM") {
        return false;
      }

      // Retry on temporary issues like ENOENT (might be race condition)
      return true;
    }

    // Don't retry on encryption errors (data corruption)
    if (ErrorHandler.isEncryptionError(error)) {
      return false;
    }

    // Retry on keychain errors (might be temporary lock)
    if (ErrorHandler.isKeychainError(error)) {
      return true;
    }

    return false;
  }

  // =====================================
  // Helper Methods
  // =====================================

  /**
   * Calculate delay with exponential backoff and jitter
   */
  static calculateDelay(attempt, baseDelay, maxDelay, exponential = true) {
    let delay;

    if (exponential) {
      // Exponential backoff: 1s, 2s, 4s, 8s...
      delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    } else {
      // Linear backoff: 1s, 2s, 3s, 4s...
      delay = Math.min(baseDelay * (attempt + 1), maxDelay);
    }

    // Add jitter (±25%) to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() - 0.5);

    return Math.max(100, Math.floor(delay + jitter)); // Minimum 100ms
  }

  /**
   * Promise-based delay
   */
  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a retry-wrapped version of a function
   */
  static wrap(fn, options = {}) {
    return async (...args) => {
      return this.withRetry(() => fn(...args), options);
    };
  }

  /**
   * Batch retry multiple operations with concurrency control
   */
  static async retryBatch(operations, options = {}) {
    const { concurrency = 3, failFast = false, retryOptions = {} } = options;

    const results = [];
    const errors = [];

    // Process in chunks based on concurrency
    for (let i = 0; i < operations.length; i += concurrency) {
      const chunk = operations.slice(i, i + concurrency);

      const chunkPromises = chunk.map(async (operation, index) => {
        try {
          const result = await RetryHandler.withRetry(operation, retryOptions);
          return { success: true, result, index: i + index };
        } catch (error) {
          const errorInfo = { success: false, error, index: i + index };

          if (failFast) {
            throw error;
          }

          return errorInfo;
        }
      });

      const chunkResults = await Promise.all(chunkPromises);

      for (const result of chunkResults) {
        if (result.success) {
          results[result.index] = result.result;
        } else {
          errors[result.index] = result.error;
        }
      }
    }

    return { results, errors };
  }
}

module.exports = RetryHandler;
