/**
 * Graceful Degradation System for Spotify Organizer
 *
 * Provides circuit breakers, fallback mechanisms, and controlled failure handling
 * to maintain system stability and user experience during errors
 */

const logger = require("./logger");
const errorReporter = require("./errorReporter");
const { ErrorFactory } = require("./customErrors");

/**
 * Circuit Breaker Pattern Implementation
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || "unnamed";
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds

    // Circuit states: 'closed', 'open', 'half-open'
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;

    // Statistics
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      circuitOpenCount: 0,
    };

    logger.debug(`Circuit breaker "${this.name}" initialized`, {
      component: "circuit_breaker",
      operation: "init",
      name: this.name,
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout,
    });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn, fallback = null) {
    this.stats.totalCalls++;

    // Check if circuit is open
    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        this.state = "half-open";
        logger.info(`Circuit breaker "${this.name}" entering half-open state`, {
          component: "circuit_breaker",
          operation: "state_change",
          name: this.name,
          newState: "half-open",
        });
      } else {
        // Circuit is still open, use fallback or throw error
        const error = new Error(`Circuit breaker "${this.name}" is open`);
        logger.warn(`Circuit breaker "${this.name}" rejected call`, {
          component: "circuit_breaker",
          operation: "call_rejected",
          name: this.name,
          state: this.state,
        });

        if (fallback) {
          return await this.executeFallback(fallback);
        }
        throw error;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);

      // If we have a fallback, try it
      if (fallback) {
        return await this.executeFallback(fallback);
      }

      throw error;
    }
  }

  /**
   * Execute fallback function
   */
  async executeFallback(fallback) {
    try {
      logger.info(`Executing fallback for circuit breaker "${this.name}"`, {
        component: "circuit_breaker",
        operation: "fallback_execution",
        name: this.name,
      });

      const result = await fallback();

      logger.info(
        `Fallback executed successfully for circuit breaker "${this.name}"`,
        {
          component: "circuit_breaker",
          operation: "fallback_success",
          name: this.name,
        }
      );

      return result;
    } catch (fallbackError) {
      logger.error(`Fallback failed for circuit breaker "${this.name}"`, {
        component: "circuit_breaker",
        operation: "fallback_failure",
        name: this.name,
        error: fallbackError.message,
      });
      throw fallbackError;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.stats.successfulCalls++;
    this.successCount++;

    if (this.state === "half-open") {
      // If we're in half-open and got a success, close the circuit
      this.state = "closed";
      this.failureCount = 0;
      logger.info(
        `Circuit breaker "${this.name}" closed after successful call`,
        {
          component: "circuit_breaker",
          operation: "state_change",
          name: this.name,
          newState: "closed",
        }
      );
    }
  }

  /**
   * Handle failed execution
   */
  onFailure(error) {
    this.stats.failedCalls++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    logger.warn(`Circuit breaker "${this.name}" recorded failure`, {
      component: "circuit_breaker",
      operation: "failure_recorded",
      name: this.name,
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      error: error.message,
    });

    // Check if we should open the circuit
    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
      this.stats.circuitOpenCount++;

      logger.error(`Circuit breaker "${this.name}" opened due to failures`, {
        component: "circuit_breaker",
        operation: "state_change",
        name: this.name,
        newState: "open",
        failureCount: this.failureCount,
      });
    }
  }

  /**
   * Check if we should attempt to reset the circuit
   */
  shouldAttemptReset() {
    return (
      this.lastFailureTime &&
      Date.now() - this.lastFailureTime >= this.resetTimeout
    );
  }

  /**
   * Get current circuit breaker status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      stats: { ...this.stats },
    };
  }

  /**
   * Reset circuit breaker manually
   */
  reset() {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;

    logger.info(`Circuit breaker "${this.name}" manually reset`, {
      component: "circuit_breaker",
      operation: "manual_reset",
      name: this.name,
    });
  }
}

/**
 * Graceful Degradation Manager
 */
class GracefulDegradation {
  constructor() {
    this.circuitBreakers = new Map();
    this.fallbackStrategies = new Map();
    this.degradationLevels = new Map();
    this.healthChecks = new Map();

    // Default degradation levels
    this.initializeDefaultDegradationLevels();

    logger.info("Graceful degradation manager initialized", {
      component: "graceful_degradation",
      operation: "init",
    });
  }

  /**
   * Initialize default degradation levels
   */
  initializeDefaultDegradationLevels() {
    this.degradationLevels.set("normal", {
      level: 0,
      description: "Full functionality available",
      enabledFeatures: ["all"],
    });

    this.degradationLevels.set("degraded", {
      level: 1,
      description: "Non-essential features disabled",
      enabledFeatures: ["core", "authentication", "basic_operations"],
    });

    this.degradationLevels.set("minimal", {
      level: 2,
      description: "Only core functionality available",
      enabledFeatures: ["core", "authentication"],
    });

    this.degradationLevels.set("critical", {
      level: 3,
      description: "Emergency mode - minimal functionality",
      enabledFeatures: ["authentication"],
    });
  }

  /**
   * Create or get a circuit breaker
   */
  getCircuitBreaker(name, options = {}) {
    if (!this.circuitBreakers.has(name)) {
      this.circuitBreakers.set(
        name,
        new CircuitBreaker({
          name,
          ...options,
        })
      );
    }
    return this.circuitBreakers.get(name);
  }

  /**
   * Execute function with circuit breaker protection
   */
  async executeWithCircuitBreaker(name, fn, options = {}) {
    const circuitBreaker = this.getCircuitBreaker(name, options);
    const fallback = options.fallback || null;

    return await circuitBreaker.execute(fn, fallback);
  }

  /**
   * Register a fallback strategy
   */
  registerFallback(operation, fallbackFn, options = {}) {
    this.fallbackStrategies.set(operation, {
      fn: fallbackFn,
      priority: options.priority || 1,
      description: options.description || "Fallback strategy",
      conditions: options.conditions || [],
    });

    logger.debug(`Registered fallback strategy for "${operation}"`, {
      component: "graceful_degradation",
      operation: "register_fallback",
      operationName: operation,
      priority: options.priority,
    });
  }

  /**
   * Execute operation with fallback handling
   */
  async executeWithFallback(operation, primaryFn, context = {}) {
    const startTime = Date.now();

    try {
      const result = await primaryFn();

      logger.debug(`Primary operation "${operation}" succeeded`, {
        component: "graceful_degradation",
        operation: "primary_success",
        operationName: operation,
        duration: Date.now() - startTime,
      });

      return { result, usedFallback: false };
    } catch (error) {
      logger.warn(
        `Primary operation "${operation}" failed, attempting fallback`,
        {
          component: "graceful_degradation",
          operation: "primary_failure",
          operationName: operation,
          error: error.message,
        }
      );

      // Try fallback if available
      const fallbackStrategy = this.fallbackStrategies.get(operation);
      if (
        fallbackStrategy &&
        this.shouldUseFallback(fallbackStrategy, error, context)
      ) {
        try {
          const fallbackResult = await fallbackStrategy.fn(error, context);

          logger.info(`Fallback strategy succeeded for "${operation}"`, {
            component: "graceful_degradation",
            operation: "fallback_success",
            operationName: operation,
            duration: Date.now() - startTime,
          });

          return { result: fallbackResult, usedFallback: true };
        } catch (fallbackError) {
          logger.error(`Fallback strategy failed for "${operation}"`, {
            component: "graceful_degradation",
            operation: "fallback_failure",
            operationName: operation,
            primaryError: error.message,
            fallbackError: fallbackError.message,
          });

          throw fallbackError;
        }
      }

      throw error;
    }
  }

  /**
   * Check if fallback should be used based on conditions
   */
  shouldUseFallback(fallbackStrategy, error, context) {
    if (fallbackStrategy.conditions.length === 0) {
      return true; // No conditions means always use fallback
    }

    return fallbackStrategy.conditions.every((condition) => {
      try {
        return condition(error, context);
      } catch (conditionError) {
        logger.warn("Fallback condition check failed", {
          component: "graceful_degradation",
          operation: "condition_check",
          error: conditionError.message,
        });
        return false;
      }
    });
  }

  /**
   * Execute with timeout and fallback
   */
  async executeWithTimeout(fn, timeout, fallbackFn = null, context = {}) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      return { result, timedOut: false, usedFallback: false };
    } catch (error) {
      if (error.message.includes("timed out") && fallbackFn) {
        logger.warn("Operation timed out, executing fallback", {
          component: "graceful_degradation",
          operation: "timeout_fallback",
          timeout,
          error: error.message,
        });

        try {
          const fallbackResult = await fallbackFn(error, context);
          return { result: fallbackResult, timedOut: true, usedFallback: true };
        } catch (fallbackError) {
          logger.error("Timeout fallback failed", {
            component: "graceful_degradation",
            operation: "timeout_fallback_failure",
            originalError: error.message,
            fallbackError: fallbackError.message,
          });
        }
      }
      throw error;
    }
  }

  /**
   * Register health check
   */
  registerHealthCheck(name, checkFn, options = {}) {
    this.healthChecks.set(name, {
      fn: checkFn,
      interval: options.interval || 30000, // 30 seconds
      timeout: options.timeout || 5000, // 5 seconds
      critical: options.critical || false,
      lastCheck: null,
      lastResult: null,
    });

    logger.debug(`Registered health check "${name}"`, {
      component: "graceful_degradation",
      operation: "register_health_check",
      name,
      interval: options.interval,
      critical: options.critical,
    });
  }

  /**
   * Run all health checks
   */
  async runHealthChecks() {
    const results = new Map();
    const promises = [];

    for (const [name, healthCheck] of this.healthChecks) {
      promises.push(this.runSingleHealthCheck(name, healthCheck));
    }

    const healthResults = await Promise.allSettled(promises);

    healthResults.forEach((result, index) => {
      const name = Array.from(this.healthChecks.keys())[index];
      results.set(
        name,
        result.value || { healthy: false, error: result.reason }
      );
    });

    return results;
  }

  /**
   * Run a single health check
   */
  async runSingleHealthCheck(name, healthCheck) {
    const startTime = Date.now();

    try {
      const result = await this.executeWithTimeout(
        healthCheck.fn,
        healthCheck.timeout,
        null,
        { healthCheckName: name }
      );

      const checkResult = {
        healthy: true,
        result: result.result,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      healthCheck.lastCheck = Date.now();
      healthCheck.lastResult = checkResult;

      logger.debug(`Health check "${name}" passed`, {
        component: "graceful_degradation",
        operation: "health_check_success",
        name,
        duration: checkResult.duration,
      });

      return checkResult;
    } catch (error) {
      const checkResult = {
        healthy: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      healthCheck.lastCheck = Date.now();
      healthCheck.lastResult = checkResult;

      logger.warn(`Health check "${name}" failed`, {
        component: "graceful_degradation",
        operation: "health_check_failure",
        name,
        error: error.message,
        duration: checkResult.duration,
      });

      return checkResult;
    }
  }

  /**
   * Get system health status
   */
  async getSystemHealth() {
    const healthResults = await this.runHealthChecks();
    const overallHealth = {
      healthy: true,
      degradationLevel: "normal",
      checks: {},
      summary: {
        total: healthResults.size,
        healthy: 0,
        unhealthy: 0,
        critical: 0,
      },
    };

    for (const [name, result] of healthResults) {
      overallHealth.checks[name] = result;

      if (result.healthy) {
        overallHealth.summary.healthy++;
      } else {
        overallHealth.summary.unhealthy++;

        const healthCheck = this.healthChecks.get(name);
        if (healthCheck && healthCheck.critical) {
          overallHealth.summary.critical++;
          overallHealth.healthy = false;
        }
      }
    }

    // Determine degradation level
    if (overallHealth.summary.critical > 0) {
      overallHealth.degradationLevel = "critical";
    } else if (
      overallHealth.summary.unhealthy > overallHealth.summary.healthy
    ) {
      overallHealth.degradationLevel = "minimal";
    } else if (overallHealth.summary.unhealthy > 0) {
      overallHealth.degradationLevel = "degraded";
    }

    return overallHealth;
  }

  /**
   * Get circuit breaker statuses
   */
  getCircuitBreakerStatus() {
    const statuses = {};
    for (const [name, breaker] of this.circuitBreakers) {
      statuses[name] = breaker.getStatus();
    }
    return statuses;
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers() {
    for (const [name, breaker] of this.circuitBreakers) {
      breaker.reset();
    }

    logger.info("All circuit breakers reset", {
      component: "graceful_degradation",
      operation: "reset_all_circuit_breakers",
      count: this.circuitBreakers.size,
    });
  }

  /**
   * Graceful shutdown handler
   */
  async gracefulShutdown(signal = "SIGTERM") {
    logger.info(`Graceful shutdown initiated (${signal})`, {
      component: "graceful_degradation",
      operation: "graceful_shutdown",
      signal,
    });

    try {
      // Flush error reports
      if (errorReporter) {
        errorReporter.flush();
      }

      // Flush logs
      await logger.flush();

      logger.info("Graceful shutdown completed", {
        component: "graceful_degradation",
        operation: "shutdown_complete",
        signal,
      });

      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown", {
        component: "graceful_degradation",
        operation: "shutdown_error",
        error: error.message,
      });

      process.exit(1);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupShutdownHandlers() {
    const signals = ["SIGTERM", "SIGINT", "SIGUSR2"];

    signals.forEach((signal) => {
      process.on(signal, () => {
        this.gracefulShutdown(signal);
      });
    });

    logger.info("Graceful shutdown handlers setup", {
      component: "graceful_degradation",
      operation: "setup_shutdown_handlers",
      signals,
    });
  }
}

// Create singleton instance
const gracefulDegradation = new GracefulDegradation();

// Setup shutdown handlers by default
gracefulDegradation.setupShutdownHandlers();

module.exports = {
  GracefulDegradation,
  CircuitBreaker,
  gracefulDegradation,
};
