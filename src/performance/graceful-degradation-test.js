/**
 * Graceful Degradation Test Suite
 *
 * Tests circuit breakers, fallback mechanisms, health checks,
 * and degradation handling for the Spotify Organizer
 */

const {
  gracefulDegradation,
  CircuitBreaker,
} = require("../utils/gracefulDegradation");
const logger = require("../utils/logger");

class GracefulDegradationTest {
  constructor() {
    this.testResults = [];
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log("🔄 Starting Graceful Degradation Tests...\n");

    await this.testCircuitBreaker();
    await this.testFallbackStrategies();
    await this.testHealthChecks();
    await this.testTimeoutHandling();
    await this.testDegradationLevels();

    this.printResults();
  }

  /**
   * Test circuit breaker functionality
   */
  async testCircuitBreaker() {
    console.log("📊 Testing Circuit Breaker...");

    const tests = [
      {
        name: "Circuit Breaker - Normal Operation",
        test: async () => {
          const breaker = new CircuitBreaker({
            name: "test-normal",
            failureThreshold: 3,
          });
          const result = await breaker.execute(() =>
            Promise.resolve("success")
          );
          return result === "success";
        },
      },
      {
        name: "Circuit Breaker - Failure Counting",
        test: async () => {
          const breaker = new CircuitBreaker({
            name: "test-failure",
            failureThreshold: 2,
          });

          // First failure
          try {
            await breaker.execute(() => Promise.reject(new Error("fail1")));
          } catch (e) {}

          // Second failure should open circuit
          try {
            await breaker.execute(() => Promise.reject(new Error("fail2")));
          } catch (e) {}

          return breaker.state === "open";
        },
      },
      {
        name: "Circuit Breaker - Fallback Execution",
        test: async () => {
          const breaker = new CircuitBreaker({
            name: "test-fallback",
            failureThreshold: 1,
          });

          // Force circuit open
          try {
            await breaker.execute(() => Promise.reject(new Error("fail")));
          } catch (e) {}

          // Test fallback
          const result = await breaker.execute(
            () => Promise.reject(new Error("fail")),
            () => Promise.resolve("fallback-success")
          );

          return result === "fallback-success";
        },
      },
      {
        name: "Circuit Breaker - Statistics",
        test: async () => {
          const breaker = new CircuitBreaker({ name: "test-stats" });

          // Execute some operations
          await breaker.execute(() => Promise.resolve("success"));
          try {
            await breaker.execute(() => Promise.reject(new Error("fail")));
          } catch (e) {}

          const stats = breaker.getStatus();
          return (
            stats.stats.totalCalls === 2 &&
            stats.stats.successfulCalls === 1 &&
            stats.stats.failedCalls === 1
          );
        },
      },
    ];

    for (const testCase of tests) {
      await this.runTest(testCase);
    }

    console.log("");
  }

  /**
   * Test fallback strategies
   */
  async testFallbackStrategies() {
    console.log("🔄 Testing Fallback Strategies...");

    const tests = [
      {
        name: "Fallback Registration",
        test: async () => {
          gracefulDegradation.registerFallback(
            "test-operation",
            (error, context) => Promise.resolve("fallback-result"),
            { priority: 1, description: "Test fallback" }
          );
          return true;
        },
      },
      {
        name: "Fallback Execution - Success Path",
        test: async () => {
          const result = await gracefulDegradation.executeWithFallback(
            "test-primary-success",
            () => Promise.resolve("primary-success")
          );
          return result.result === "primary-success" && !result.usedFallback;
        },
      },
      {
        name: "Fallback Execution - Failure Path",
        test: async () => {
          gracefulDegradation.registerFallback("test-primary-fail", () =>
            Promise.resolve("fallback-success")
          );

          const result = await gracefulDegradation.executeWithFallback(
            "test-primary-fail",
            () => Promise.reject(new Error("primary failed"))
          );
          return result.result === "fallback-success" && result.usedFallback;
        },
      },
      {
        name: "Conditional Fallback",
        test: async () => {
          gracefulDegradation.registerFallback(
            "test-conditional",
            () => Promise.resolve("conditional-fallback"),
            {
              conditions: [
                (error, context) => error.message.includes("network"),
              ],
            }
          );

          // Should use fallback for network error
          const result1 = await gracefulDegradation.executeWithFallback(
            "test-conditional",
            () => Promise.reject(new Error("network timeout"))
          );

          // Should not use fallback for other errors
          let result2;
          try {
            result2 = await gracefulDegradation.executeWithFallback(
              "test-conditional",
              () => Promise.reject(new Error("auth error"))
            );
          } catch (e) {
            result2 = { usedFallback: false, error: e.message };
          }

          return result1.usedFallback && !result2.usedFallback;
        },
      },
    ];

    for (const testCase of tests) {
      await this.runTest(testCase);
    }

    console.log("");
  }

  /**
   * Test health checks
   */
  async testHealthChecks() {
    console.log("🏥 Testing Health Checks...");

    const tests = [
      {
        name: "Health Check Registration",
        test: async () => {
          gracefulDegradation.registerHealthCheck(
            "test-health",
            () => Promise.resolve({ status: "healthy" }),
            { timeout: 1000, critical: true }
          );
          return true;
        },
      },
      {
        name: "Health Check - Passing",
        test: async () => {
          gracefulDegradation.registerHealthCheck(
            "test-health-pass",
            () => Promise.resolve({ database: "connected" }),
            { timeout: 1000 }
          );

          const results = await gracefulDegradation.runHealthChecks();
          const healthResult = results.get("test-health-pass");
          return healthResult && healthResult.healthy === true;
        },
      },
      {
        name: "Health Check - Failing",
        test: async () => {
          gracefulDegradation.registerHealthCheck(
            "test-health-fail",
            () => Promise.reject(new Error("Service unavailable")),
            { timeout: 1000 }
          );

          const results = await gracefulDegradation.runHealthChecks();
          const healthResult = results.get("test-health-fail");
          return healthResult && healthResult.healthy === false;
        },
      },
      {
        name: "System Health Status",
        test: async () => {
          // Register a mix of healthy and unhealthy checks
          gracefulDegradation.registerHealthCheck(
            "healthy-service",
            () => Promise.resolve({ status: "ok" }),
            { critical: false }
          );

          gracefulDegradation.registerHealthCheck(
            "unhealthy-service",
            () => Promise.reject(new Error("Down")),
            { critical: false }
          );

          const systemHealth = await gracefulDegradation.getSystemHealth();
          return (
            systemHealth.summary.total >= 2 &&
            systemHealth.summary.healthy >= 1 &&
            systemHealth.summary.unhealthy >= 1
          );
        },
      },
    ];

    for (const testCase of tests) {
      await this.runTest(testCase);
    }

    console.log("");
  }

  /**
   * Test timeout handling
   */
  async testTimeoutHandling() {
    console.log("⏱️  Testing Timeout Handling...");

    const tests = [
      {
        name: "Timeout - Success Within Limit",
        test: async () => {
          const result = await gracefulDegradation.executeWithTimeout(
            () =>
              new Promise((resolve) => setTimeout(() => resolve("fast"), 100)),
            1000
          );
          return result.result === "fast" && !result.timedOut;
        },
      },
      {
        name: "Timeout - Exceeds Limit",
        test: async () => {
          try {
            await gracefulDegradation.executeWithTimeout(
              () =>
                new Promise((resolve) =>
                  setTimeout(() => resolve("slow"), 1000)
                ),
              100
            );
            return false;
          } catch (error) {
            return error.message.includes("timed out");
          }
        },
      },
      {
        name: "Timeout with Fallback",
        test: async () => {
          const result = await gracefulDegradation.executeWithTimeout(
            () =>
              new Promise((resolve) => setTimeout(() => resolve("slow"), 1000)),
            100,
            () => Promise.resolve("timeout-fallback")
          );
          return (
            result.result === "timeout-fallback" &&
            result.timedOut &&
            result.usedFallback
          );
        },
      },
    ];

    for (const testCase of tests) {
      await this.runTest(testCase);
    }

    console.log("");
  }

  /**
   * Test degradation levels
   */
  async testDegradationLevels() {
    console.log("📉 Testing Degradation Levels...");

    const tests = [
      {
        name: "Circuit Breaker Integration",
        test: async () => {
          const result = await gracefulDegradation.executeWithCircuitBreaker(
            "integration-test",
            () => Promise.resolve("circuit-success"),
            { failureThreshold: 3 }
          );
          return result === "circuit-success";
        },
      },
      {
        name: "Circuit Breaker Status",
        test: async () => {
          // Create some circuit breakers
          await gracefulDegradation.executeWithCircuitBreaker(
            "status-test-1",
            () => Promise.resolve("ok")
          );

          const statuses = gracefulDegradation.getCircuitBreakerStatus();
          return Object.keys(statuses).length >= 1;
        },
      },
      {
        name: "Circuit Breaker Reset",
        test: async () => {
          const breaker = gracefulDegradation.getCircuitBreaker("reset-test");

          // Force some failures
          try {
            await breaker.execute(() => Promise.reject(new Error("fail")));
          } catch (e) {}

          // Reset and check
          gracefulDegradation.resetAllCircuitBreakers();
          const status = breaker.getStatus();
          return status.failureCount === 0 && status.state === "closed";
        },
      },
    ];

    for (const testCase of tests) {
      await this.runTest(testCase);
    }

    console.log("");
  }

  /**
   * Run a single test
   */
  async runTest(testCase) {
    try {
      const startTime = Date.now();
      const result = await testCase.test();
      const duration = Date.now() - startTime;

      if (result) {
        console.log(`✅ ${testCase.name} (${duration}ms)`);
        this.testResults.push({
          name: testCase.name,
          status: "PASS",
          duration,
        });
      } else {
        console.log(`❌ ${testCase.name} (${duration}ms)`);
        this.testResults.push({
          name: testCase.name,
          status: "FAIL",
          duration,
        });
      }
    } catch (error) {
      console.log(`💥 ${testCase.name} - Error: ${error.message}`);
      this.testResults.push({
        name: testCase.name,
        status: "ERROR",
        error: error.message,
      });
    }
  }

  /**
   * Print test results summary
   */
  printResults() {
    console.log("\n📋 Test Results Summary:");
    console.log("═".repeat(60));

    const passed = this.testResults.filter((r) => r.status === "PASS").length;
    const failed = this.testResults.filter((r) => r.status === "FAIL").length;
    const errors = this.testResults.filter((r) => r.status === "ERROR").length;
    const total = this.testResults.length;

    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`💥 Errors: ${errors}`);

    if (failed > 0 || errors > 0) {
      console.log("\n❌ Failed/Error Tests:");
      this.testResults
        .filter((r) => r.status !== "PASS")
        .forEach((result) => {
          console.log(
            `  • ${result.name}: ${result.status} ${
              result.error ? `(${result.error})` : ""
            }`
          );
        });
    }

    const passRate = ((passed / total) * 100).toFixed(1);
    console.log(`\n📊 Pass Rate: ${passRate}%`);

    if (passRate >= 90) {
      console.log("🎉 Excellent! Graceful degradation system is working well.");
    } else if (passRate >= 75) {
      console.log("⚠️  Good, but some improvements needed.");
    } else {
      console.log("🚨 System needs attention - multiple test failures.");
    }
  }
}

// Performance demonstration
async function demonstrateGracefulDegradation() {
  console.log("\n🎭 Demonstrating Graceful Degradation Features:\n");

  // Demonstrate circuit breaker with real Spotify API simulation
  console.log("1. Simulating Spotify API with Circuit Breaker...");
  gracefulDegradation.registerFallback(
    "spotify-api-call",
    () => Promise.resolve({ data: "cached-playlists", source: "cache" }),
    { description: "Use cached data when API fails" }
  );

  const apiResult = await gracefulDegradation.executeWithFallback(
    "spotify-api-call",
    () => Promise.reject(new Error("Spotify API rate limit exceeded"))
  );

  console.log(
    `  Result: ${JSON.stringify(apiResult.result)} (fallback: ${
      apiResult.usedFallback
    })`
  );

  // Demonstrate health checks
  console.log("\n2. Registering Application Health Checks...");
  gracefulDegradation.registerHealthCheck(
    "database",
    () => Promise.resolve({ status: "connected", latency: "2ms" }),
    { critical: true }
  );

  gracefulDegradation.registerHealthCheck(
    "spotify-api",
    () => Promise.resolve({ status: "healthy", rateLimit: "1000/hour" }),
    { critical: false }
  );

  const health = await gracefulDegradation.getSystemHealth();
  console.log(
    `  System Health: ${health.degradationLevel} (${health.summary.healthy}/${health.summary.total} healthy)`
  );

  // Demonstrate timeout with fallback
  console.log("\n3. Testing Timeout Handling...");
  const timeoutResult = await gracefulDegradation.executeWithTimeout(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve("slow-operation"), 2000)
      ),
    500,
    () => Promise.resolve("quick-alternative")
  );

  console.log(
    `  Timeout Result: ${timeoutResult.result} (timed out: ${timeoutResult.timedOut})`
  );

  console.log("\n✨ Graceful degradation demonstration complete!");
}

// Export for use in other tests
module.exports = GracefulDegradationTest;

// Run tests if executed directly
if (require.main === module) {
  (async () => {
    try {
      const test = new GracefulDegradationTest();
      await test.runAllTests();
      await demonstrateGracefulDegradation();

      process.exit(0);
    } catch (error) {
      console.error("Test execution failed:", error);
      process.exit(1);
    }
  })();
}
