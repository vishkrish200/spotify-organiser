/**
 * Centralized Logging System for Spotify Organizer
 *
 * Provides structured logging with Winston, including file rotation,
 * multiple log levels, and formatted output for debugging and monitoring
 */

const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const path = require("path");
const fs = require("fs");
const os = require("os");

class Logger {
  constructor() {
    this.logDir = path.join(os.homedir(), ".spotify-organizer", "logs");
    this.ensureLogDirectory();

    // Create Winston logger instance
    this.winston = winston.createLogger({
      level: this.getLogLevel(),
      format: this.createLogFormat(),
      defaultMeta: {
        service: "spotify-organizer",
        version: process.env.npm_package_version || "1.0.0",
      },
      transports: this.createTransports(),
      exceptionHandlers: this.createExceptionHandlers(),
      rejectionHandlers: this.createRejectionHandlers(),
      exitOnError: false,
    });

    // Handle process events for graceful logging shutdown
    this.setupProcessHandlers();
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error("Failed to create log directory:", error.message);
    }
  }

  /**
   * Get log level from environment or default to 'info'
   */
  getLogLevel() {
    const level =
      process.env.LOG_LEVEL || process.env.SPOTIFY_LOG_LEVEL || "info";
    const validLevels = [
      "error",
      "warn",
      "info",
      "http",
      "verbose",
      "debug",
      "silly",
    ];

    return validLevels.includes(level) ? level : "info";
  }

  /**
   * Create Winston log format with timestamps and colors
   */
  createLogFormat() {
    const { combine, timestamp, errors, json, printf, colorize } =
      winston.format;

    // Custom format for console output
    const consoleFormat = printf(
      ({ level, message, timestamp, component, operation, ...meta }) => {
        let output = `${timestamp} [${level.toUpperCase()}]`;

        if (component) output += ` [${component}]`;
        if (operation) output += ` [${operation}]`;

        output += `: ${message}`;

        // Add metadata if present
        const metaKeys = Object.keys(meta).filter(
          (key) => !["service", "version"].includes(key)
        );
        if (metaKeys.length > 0) {
          const metaStr = JSON.stringify(meta, null, 2);
          output += `\n${metaStr}`;
        }

        return output;
      }
    );

    // Default format for files (JSON with timestamp and error stack)
    return combine(
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      errors({ stack: true }),
      json()
    );
  }

  /**
   * Create console format separately
   */
  createConsoleFormat() {
    const { combine, timestamp, errors, printf, colorize } = winston.format;

    const consoleFormat = printf(
      ({ level, message, timestamp, component, operation, ...meta }) => {
        let output = `${timestamp} [${level.toUpperCase()}]`;

        if (component) output += ` [${component}]`;
        if (operation) output += ` [${operation}]`;

        output += `: ${message}`;

        // Add metadata if present
        const metaKeys = Object.keys(meta).filter(
          (key) => !["service", "version"].includes(key)
        );
        if (metaKeys.length > 0) {
          const metaStr = JSON.stringify(meta, null, 2);
          output += `\n${metaStr}`;
        }

        return output;
      }
    );

    return combine(
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      errors({ stack: true }),
      colorize(),
      consoleFormat
    );
  }

  /**
   * Create Winston transports for different output targets
   */
  createTransports() {
    const transports = [];

    // Console transport for development
    if (
      process.env.NODE_ENV !== "production" ||
      process.env.CONSOLE_LOGGING === "true"
    ) {
      transports.push(
        new winston.transports.Console({
          format: this.createConsoleFormat(),
          level: this.getLogLevel(),
        })
      );
    }

    // File transport with daily rotation for all logs
    transports.push(
      new DailyRotateFile({
        filename: path.join(this.logDir, "spotify-organizer-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        maxSize: "20m",
        maxFiles: "14d",
        format: this.createLogFormat(),
        level: "info",
      })
    );

    // Separate error log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(this.logDir, "error-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        maxSize: "20m",
        maxFiles: "30d",
        format: this.createLogFormat(),
        level: "error",
      })
    );

    // Debug log file (only if debug level is enabled)
    if (this.getLogLevel() === "debug" || this.getLogLevel() === "silly") {
      transports.push(
        new DailyRotateFile({
          filename: path.join(this.logDir, "debug-%DATE%.log"),
          datePattern: "YYYY-MM-DD",
          maxSize: "50m",
          maxFiles: "7d",
          format: this.createLogFormat(),
          level: "debug",
        })
      );
    }

    return transports;
  }

  /**
   * Create exception handlers for uncaught exceptions
   */
  createExceptionHandlers() {
    return [
      new winston.transports.File({
        filename: path.join(this.logDir, "exceptions.log"),
        format: this.createLogFormat(),
      }),
    ];
  }

  /**
   * Create rejection handlers for unhandled promise rejections
   */
  createRejectionHandlers() {
    return [
      new winston.transports.File({
        filename: path.join(this.logDir, "rejections.log"),
        format: this.createLogFormat(),
      }),
    ];
  }

  /**
   * Setup process event handlers
   */
  setupProcessHandlers() {
    // Graceful shutdown
    process.on("SIGINT", () => {
      this.info("Received SIGINT, shutting down gracefully");
      this.winston.end();
    });

    process.on("SIGTERM", () => {
      this.info("Received SIGTERM, shutting down gracefully");
      this.winston.end();
    });
  }

  /**
   * Create a child logger with additional metadata
   */
  child(metadata = {}) {
    return new Proxy(this, {
      get: (target, prop) => {
        if (
          typeof target[prop] === "function" &&
          ["error", "warn", "info", "debug", "verbose"].includes(prop)
        ) {
          return (message, meta = {}) => {
            return target[prop](message, { ...metadata, ...meta });
          };
        }
        return target[prop];
      },
    });
  }

  /**
   * Log error level messages
   */
  error(message, meta = {}) {
    this.winston.error(message, meta);
  }

  /**
   * Log warning level messages
   */
  warn(message, meta = {}) {
    this.winston.warn(message, meta);
  }

  /**
   * Log info level messages
   */
  info(message, meta = {}) {
    this.winston.info(message, meta);
  }

  /**
   * Log HTTP request/response information
   */
  http(message, meta = {}) {
    this.winston.http(message, meta);
  }

  /**
   * Log verbose information
   */
  verbose(message, meta = {}) {
    this.winston.verbose(message, meta);
  }

  /**
   * Log debug level messages
   */
  debug(message, meta = {}) {
    this.winston.debug(message, meta);
  }

  /**
   * Log silly level messages (highest verbosity)
   */
  silly(message, meta = {}) {
    this.winston.silly(message, meta);
  }

  /**
   * Log an error object with full context
   */
  logError(error, context = "", metadata = {}) {
    const errorMeta = {
      component: metadata.component || "unknown",
      operation: metadata.operation || "unknown",
      context,
      errorName: error.name,
      errorCode: error.errorCode || error.code,
      stack: error.stack,
      ...metadata,
    };

    // Log custom error details if available
    if (error.toJSON && typeof error.toJSON === "function") {
      errorMeta.customError = error.toJSON();
    }

    // Include inner error if present
    if (error.innerError) {
      errorMeta.innerError = {
        name: error.innerError.name,
        message: error.innerError.message,
        stack: error.innerError.stack,
      };
    }

    this.error(error.message, errorMeta);
  }

  /**
   * Log HTTP requests and responses
   */
  logHTTPRequest(method, url, statusCode, duration, metadata = {}) {
    const httpMeta = {
      component: "http",
      operation: "request",
      method,
      url,
      statusCode,
      duration,
      ...metadata,
    };

    const level = statusCode >= 400 ? "warn" : "http";
    this[level](`${method} ${url} ${statusCode} ${duration}ms`, httpMeta);
  }

  /**
   * Log operation timing
   */
  logTiming(operation, duration, metadata = {}) {
    this.info(`Operation "${operation}" completed in ${duration}ms`, {
      component: "performance",
      operation,
      duration,
      ...metadata,
    });
  }

  /**
   * Log authentication events
   */
  logAuth(event, success = true, metadata = {}) {
    const authMeta = {
      component: "auth",
      operation: event,
      success,
      ...metadata,
    };

    const level = success ? "info" : "warn";
    const message = `Authentication ${event} ${
      success ? "succeeded" : "failed"
    }`;

    this[level](message, authMeta);
  }

  /**
   * Log storage operations
   */
  logStorage(operation, storageType, success = true, metadata = {}) {
    const storageMeta = {
      component: "storage",
      operation,
      storageType,
      success,
      ...metadata,
    };

    const level = success ? "debug" : "warn";
    const message = `Storage ${operation} on ${storageType} ${
      success ? "succeeded" : "failed"
    }`;

    this[level](message, storageMeta);
  }

  /**
   * Log Spotify API operations
   */
  logSpotifyAPI(operation, endpoint, success = true, metadata = {}) {
    const apiMeta = {
      component: "spotify",
      operation,
      endpoint,
      success,
      ...metadata,
    };

    const level = success ? "info" : "warn";
    const message = `Spotify API ${operation} ${
      success ? "succeeded" : "failed"
    }`;

    this[level](message, apiMeta);
  }

  /**
   * Get log statistics
   */
  getLogStats() {
    try {
      const logFiles = fs.readdirSync(this.logDir);
      const stats = {
        logDirectory: this.logDir,
        logLevel: this.getLogLevel(),
        files: [],
      };

      for (const file of logFiles) {
        const filePath = path.join(this.logDir, file);
        const fileStats = fs.statSync(filePath);

        stats.files.push({
          name: file,
          size: fileStats.size,
          modified: fileStats.mtime,
          sizeFormatted: this.formatFileSize(fileStats.size),
        });
      }

      return stats;
    } catch (error) {
      this.error("Failed to get log statistics", { error: error.message });
      return null;
    }
  }

  /**
   * Format file size in human-readable format
   */
  formatFileSize(bytes) {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Bytes";

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  }

  /**
   * Clean up old log files
   */
  cleanupOldLogs(daysToKeep = 30) {
    try {
      const logFiles = fs.readdirSync(this.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      let deletedFiles = 0;

      for (const file of logFiles) {
        const filePath = path.join(this.logDir, file);
        const fileStats = fs.statSync(filePath);

        if (fileStats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          deletedFiles++;
          this.info(`Deleted old log file: ${file}`);
        }
      }

      this.info(`Log cleanup completed. Deleted ${deletedFiles} old files.`);
      return deletedFiles;
    } catch (error) {
      this.error("Failed to cleanup old logs", { error: error.message });
      return 0;
    }
  }

  /**
   * Flush all pending logs
   */
  flush() {
    return new Promise((resolve) => {
      this.winston.end(() => {
        resolve();
      });
    });
  }
}

// Create singleton logger instance
const logger = new Logger();

module.exports = logger;
