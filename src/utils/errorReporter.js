/**
 * Error Reporting System for Spotify Organizer
 *
 * Provides comprehensive error reporting, aggregation, and optional
 * integration with external error tracking services
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const logger = require("./logger");

class ErrorReporter {
  constructor() {
    this.reportDir = path.join(
      os.homedir(),
      ".spotify-organizer",
      "error-reports"
    );
    this.sessionId = this.generateSessionId();
    this.errorBuffer = [];
    this.maxBufferSize = 100;
    this.reportInterval = 5 * 60 * 1000; // 5 minutes
    this.initialized = false;

    this.init();
  }

  /**
   * Initialize error reporter
   */
  init() {
    try {
      this.ensureReportDirectory();
      this.startPeriodicReporting();
      this.setupProcessHandlers();
      this.initialized = true;

      logger.info("Error reporter initialized", {
        component: "error_reporter",
        operation: "init",
        sessionId: this.sessionId,
        reportDir: this.reportDir,
      });
    } catch (error) {
      console.error("Failed to initialize error reporter:", error.message);
    }
  }

  /**
   * Ensure report directory exists
   */
  ensureReportDirectory() {
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Report an error with full context
   */
  reportError(error, context = "", metadata = {}) {
    if (!this.initialized) {
      console.warn("Error reporter not initialized, logging error directly");
      logger.logError(error, context, metadata);
      return;
    }

    const errorReport = this.createErrorReport(error, context, metadata);

    // Add to buffer
    this.errorBuffer.push(errorReport);

    // If buffer is full, flush immediately
    if (this.errorBuffer.length >= this.maxBufferSize) {
      this.flushErrorBuffer();
    }

    // Log error immediately
    logger.logError(error, context, {
      ...metadata,
      reportId: errorReport.id,
      sessionId: this.sessionId,
    });

    // Send to external service if configured
    this.sendToExternalService(errorReport);

    return errorReport;
  }

  /**
   * Create detailed error report
   */
  createErrorReport(error, context, metadata) {
    const timestamp = new Date().toISOString();
    const reportId = `error_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;

    const report = {
      id: reportId,
      sessionId: this.sessionId,
      timestamp,
      context,

      // Error details
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code || error.errorCode,

        // Custom error properties
        ...(error.toJSON ? error.toJSON() : {}),

        // Additional error metadata
        category: error.category || "unknown",
        component: error.metadata?.component || metadata.component || "unknown",
        operation: error.metadata?.operation || metadata.operation || "unknown",
        severity: error.metadata?.severity || metadata.severity || "error",
        shouldRetry: error.shouldRetry || false,
        userMessage: error.userMessage || error.message,

        // Inner error if present
        innerError: error.innerError
          ? {
              name: error.innerError.name,
              message: error.innerError.message,
              stack: error.innerError.stack,
              code: error.innerError.code,
            }
          : null,
      },

      // System context
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        cwd: process.cwd(),
        pid: process.pid,
      },

      // Application context
      application: {
        version: process.env.npm_package_version || "1.0.0",
        environment: process.env.NODE_ENV || "development",
        logLevel: process.env.LOG_LEVEL || "info",
      },

      // User metadata
      metadata: {
        ...metadata,
        userAgent: this.getUserAgent(),
        locale: this.getLocale(),
      },

      // Performance metrics
      performance: {
        cpuUsage: process.cpuUsage(),
        memoryUsage: process.memoryUsage(),
        hrtime: process.hrtime(),
      },
    };

    return report;
  }

  /**
   * Get user agent information
   */
  getUserAgent() {
    return `spotify-organizer/${
      process.env.npm_package_version || "1.0.0"
    } (${os.platform()} ${os.arch()}) Node.js/${process.version}`;
  }

  /**
   * Get locale information
   */
  getLocale() {
    return process.env.LANG || process.env.LC_ALL || "en_US.UTF-8";
  }

  /**
   * Flush error buffer to file
   */
  flushErrorBuffer() {
    if (this.errorBuffer.length === 0) {
      return;
    }

    const reportFile = path.join(
      this.reportDir,
      `error-report-${new Date().toISOString().split("T")[0]}.json`
    );

    try {
      let existingReports = [];

      // Read existing reports if file exists
      if (fs.existsSync(reportFile)) {
        const content = fs.readFileSync(reportFile, "utf8");
        existingReports = JSON.parse(content);
      }

      // Append new reports
      const updatedReports = [...existingReports, ...this.errorBuffer];

      // Write to file
      fs.writeFileSync(reportFile, JSON.stringify(updatedReports, null, 2));

      logger.info(`Flushed ${this.errorBuffer.length} error reports`, {
        component: "error_reporter",
        operation: "flush_buffer",
        reportCount: this.errorBuffer.length,
        reportFile,
      });

      // Clear buffer
      this.errorBuffer = [];
    } catch (error) {
      console.error("Failed to flush error buffer:", error.message);
      logger.error("Failed to flush error buffer", {
        component: "error_reporter",
        operation: "flush_buffer",
        error: error.message,
      });
    }
  }

  /**
   * Start periodic error reporting
   */
  startPeriodicReporting() {
    setInterval(() => {
      this.flushErrorBuffer();
    }, this.reportInterval);
  }

  /**
   * Setup process event handlers
   */
  setupProcessHandlers() {
    // Flush on exit
    process.on("exit", () => {
      this.flushErrorBuffer();
    });

    // Flush on SIGINT/SIGTERM
    process.on("SIGINT", () => {
      this.flushErrorBuffer();
    });

    process.on("SIGTERM", () => {
      this.flushErrorBuffer();
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      const errorReport = this.reportError(error, "uncaught_exception", {
        component: "process",
        operation: "uncaught_exception",
        severity: "critical",
      });

      console.error("Uncaught Exception:", error);
      this.flushErrorBuffer();

      // Exit after logging
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));

      const errorReport = this.reportError(error, "unhandled_rejection", {
        component: "promise",
        operation: "unhandled_rejection",
        severity: "critical",
        promise: String(promise),
      });

      console.error("Unhandled Rejection:", reason);
      this.flushErrorBuffer();
    });
  }

  /**
   * Send error to external tracking service (optional)
   */
  sendToExternalService(errorReport) {
    // Placeholder for external service integration
    // Can be extended to integrate with services like Sentry, Bugsnag, etc.

    const externalService = process.env.ERROR_TRACKING_SERVICE;

    if (!externalService) {
      return; // No external service configured
    }

    try {
      switch (externalService.toLowerCase()) {
        case "sentry":
          this.sendToSentry(errorReport);
          break;
        case "custom":
          this.sendToCustomService(errorReport);
          break;
        default:
          logger.debug(`Unknown error tracking service: ${externalService}`);
      }
    } catch (error) {
      logger.error("Failed to send error to external service", {
        component: "error_reporter",
        operation: "external_service",
        service: externalService,
        error: error.message,
      });
    }
  }

  /**
   * Send to Sentry (placeholder)
   */
  sendToSentry(errorReport) {
    // Placeholder for Sentry integration
    logger.debug("Sentry integration not implemented", {
      component: "error_reporter",
      operation: "sentry",
      reportId: errorReport.id,
    });
  }

  /**
   * Send to custom service (placeholder)
   */
  sendToCustomService(errorReport) {
    // Placeholder for custom service integration
    const webhook = process.env.ERROR_WEBHOOK_URL;

    if (webhook) {
      logger.debug("Custom webhook integration not implemented", {
        component: "error_reporter",
        operation: "custom_webhook",
        reportId: errorReport.id,
        webhook,
      });
    }
  }

  /**
   * Get error statistics
   */
  getErrorStats(days = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const reportFiles = fs.readdirSync(this.reportDir);
      const stats = {
        totalErrors: 0,
        errorsByCategory: {},
        errorsByComponent: {},
        errorsBySeverity: {},
        timeRange: {
          from: cutoffDate.toISOString(),
          to: new Date().toISOString(),
        },
      };

      for (const file of reportFiles) {
        if (!file.endsWith(".json")) continue;

        const filePath = path.join(this.reportDir, file);
        const fileDate = new Date(file.match(/\d{4}-\d{2}-\d{2}/)?.[0]);

        if (fileDate < cutoffDate) continue;

        try {
          const content = fs.readFileSync(filePath, "utf8");
          const reports = JSON.parse(content);

          for (const report of reports) {
            if (new Date(report.timestamp) < cutoffDate) continue;

            stats.totalErrors++;

            // Count by category
            const category = report.error.category || "unknown";
            stats.errorsByCategory[category] =
              (stats.errorsByCategory[category] || 0) + 1;

            // Count by component
            const component = report.error.component || "unknown";
            stats.errorsByComponent[component] =
              (stats.errorsByComponent[component] || 0) + 1;

            // Count by severity
            const severity = report.error.severity || "error";
            stats.errorsBySeverity[severity] =
              (stats.errorsBySeverity[severity] || 0) + 1;
          }
        } catch (parseError) {
          logger.warn(`Failed to parse error report file: ${file}`, {
            component: "error_reporter",
            operation: "get_stats",
            error: parseError.message,
          });
        }
      }

      return stats;
    } catch (error) {
      logger.error("Failed to get error statistics", {
        component: "error_reporter",
        operation: "get_stats",
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Clean up old error reports
   */
  cleanupOldReports(daysToKeep = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const reportFiles = fs.readdirSync(this.reportDir);
      let deletedFiles = 0;

      for (const file of reportFiles) {
        const filePath = path.join(this.reportDir, file);
        const fileStats = fs.statSync(filePath);

        if (fileStats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          deletedFiles++;
        }
      }

      logger.info(`Cleaned up ${deletedFiles} old error report files`, {
        component: "error_reporter",
        operation: "cleanup",
        deletedFiles,
        daysToKeep,
      });

      return deletedFiles;
    } catch (error) {
      logger.error("Failed to cleanup old error reports", {
        component: "error_reporter",
        operation: "cleanup",
        error: error.message,
      });
      return 0;
    }
  }

  /**
   * Force flush all pending reports
   */
  flush() {
    this.flushErrorBuffer();
  }

  /**
   * Get current session information
   */
  getSessionInfo() {
    return {
      sessionId: this.sessionId,
      initialized: this.initialized,
      bufferSize: this.errorBuffer.length,
      maxBufferSize: this.maxBufferSize,
      reportInterval: this.reportInterval,
      reportDir: this.reportDir,
    };
  }
}

// Create singleton error reporter instance
const errorReporter = new ErrorReporter();

module.exports = errorReporter;
