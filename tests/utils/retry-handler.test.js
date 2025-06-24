const {
  retryWithBackoff,
  isRetryableError,
  exponentialBackoff,
  createRetryConfig,
  retryNetworkOperation,
  retryAuthOperation,
  retryStorageOperation,
} = require("../../src/utils/retryHandler");

describe("Retry Handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock console.log to suppress output during tests
    jest.spyOn(console, "log").mockImplementation();
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  describe("exponentialBackoff", () => {
    test("should calculate exponential backoff correctly", () => {
      expect(exponentialBackoff(0)).toBe(1000); // 1 second base
      expect(exponentialBackoff(1)).toBe(2000); // 2 seconds
      expect(exponentialBackoff(2)).toBe(4000); // 4 seconds
      expect(exponentialBackoff(3)).toBe(8000); // 8 seconds
    });

    test("should add jitter to prevent thundering herd", () => {
      const delay1 = exponentialBackoff(1, true);
      const delay2 = exponentialBackoff(1, true);

      // Both should be around 2000ms but slightly different due to jitter
      expect(delay1).toBeGreaterThan(1500);
      expect(delay1).toBeLessThan(2500);
      expect(delay2).toBeGreaterThan(1500);
      expect(delay2).toBeLessThan(2500);

      // They should be different due to random jitter
      expect(delay1).not.toBe(delay2);
    });

    test("should cap maximum delay", () => {
      const maxDelay = exponentialBackoff(10); // Very high attempt
      expect(maxDelay).toBeLessThanOrEqual(30000); // 30 second cap
    });
  });

  describe("isRetryableError", () => {
    test("should identify retryable network errors", () => {
      const networkError = new Error("Network error");
      networkError.code = "ENOTFOUND";

      expect(isRetryableError(networkError)).toBe(true);
    });

    test("should identify retryable timeout errors", () => {
      const timeoutError = new Error("Timeout");
      timeoutError.code = "ETIMEDOUT";

      expect(isRetryableError(timeoutError)).toBe(true);
    });

    test("should identify retryable 5xx errors", () => {
      const serverError = new Error("Server error");
      serverError.statusCode = 500;

      expect(isRetryableError(serverError)).toBe(true);
    });

    test("should identify retryable rate limit errors", () => {
      const rateLimitError = new Error("Rate limited");
      rateLimitError.statusCode = 429;

      expect(isRetryableError(rateLimitError)).toBe(true);
    });

    test("should not retry 4xx client errors (except 429)", () => {
      const clientError = new Error("Bad request");
      clientError.statusCode = 400;

      expect(isRetryableError(clientError)).toBe(false);
    });

    test("should not retry authentication errors", () => {
      const authError = new Error("Unauthorized");
      authError.statusCode = 401;

      expect(isRetryableError(authError)).toBe(false);
    });

    test("should not retry configuration errors", () => {
      const configError = new Error("Missing environment variables");

      expect(isRetryableError(configError)).toBe(false);
    });
  });

  describe("createRetryConfig", () => {
    test("should create default retry config", () => {
      const config = createRetryConfig();

      expect(config).toEqual({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        useJitter: true,
      });
    });

    test("should override default config", () => {
      const config = createRetryConfig({
        maxRetries: 5,
        baseDelay: 2000,
      });

      expect(config).toEqual({
        maxRetries: 5,
        baseDelay: 2000,
        maxDelay: 30000,
        useJitter: true,
      });
    });
  });

  describe("retryWithBackoff", () => {
    test("should succeed on first attempt", async () => {
      const successfulOperation = jest.fn().mockResolvedValue("success");

      const result = await retryWithBackoff(successfulOperation);

      expect(result).toBe("success");
      expect(successfulOperation).toHaveBeenCalledTimes(1);
    });

    test("should retry on retryable errors", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("ENOTFOUND"))
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockResolvedValueOnce("success");

      // Mock setTimeout to make test faster
      jest.spyOn(global, "setTimeout").mockImplementation((fn) => fn());

      const result = await retryWithBackoff(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);

      global.setTimeout.mockRestore();
    });

    test("should not retry on non-retryable errors", async () => {
      const operation = jest.fn().mockRejectedValue(new Error("Bad request"));
      operation.mockImplementation(() => {
        const error = new Error("Bad request");
        error.statusCode = 400;
        throw error;
      });

      await expect(retryWithBackoff(operation)).rejects.toThrow("Bad request");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test("should fail after max retries", async () => {
      const operation = jest.fn().mockRejectedValue(new Error("ENOTFOUND"));

      // Mock setTimeout to make test faster
      jest.spyOn(global, "setTimeout").mockImplementation((fn) => fn());

      await expect(
        retryWithBackoff(operation, { maxRetries: 2 })
      ).rejects.toThrow("ENOTFOUND");
      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries

      global.setTimeout.mockRestore();
    });

    test("should use custom retry config", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("ENOTFOUND"))
        .mockResolvedValueOnce("success");

      jest.spyOn(global, "setTimeout").mockImplementation((fn) => fn());

      const result = await retryWithBackoff(operation, {
        maxRetries: 1,
        baseDelay: 500,
      });

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);

      global.setTimeout.mockRestore();
    });

    test("should handle custom retry logic", async () => {
      const operation = jest.fn().mockRejectedValue(new Error("Custom error"));
      const customRetryLogic = jest.fn().mockReturnValue(true);

      jest.spyOn(global, "setTimeout").mockImplementation((fn) => fn());

      await expect(
        retryWithBackoff(operation, {
          maxRetries: 1,
          retryCondition: customRetryLogic,
        })
      ).rejects.toThrow("Custom error");

      expect(customRetryLogic).toHaveBeenCalledWith(expect.any(Error));
      expect(operation).toHaveBeenCalledTimes(2);

      global.setTimeout.mockRestore();
    });
  });

  describe("specialized retry functions", () => {
    beforeEach(() => {
      jest.spyOn(global, "setTimeout").mockImplementation((fn) => fn());
    });

    afterEach(() => {
      global.setTimeout.mockRestore();
    });

    test("retryNetworkOperation should use network-specific config", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("ENOTFOUND"))
        .mockResolvedValueOnce("success");

      const result = await retryNetworkOperation(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test("retryAuthOperation should use auth-specific config", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce({ statusCode: 500 })
        .mockResolvedValueOnce("success");

      const result = await retryAuthOperation(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test("retryStorageOperation should use storage-specific config", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("Temporary storage error"))
        .mockResolvedValueOnce("success");

      const result = await retryStorageOperation(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test("should not retry auth errors in retryAuthOperation", async () => {
      const operation = jest.fn().mockRejectedValue({
        statusCode: 401,
        message: "Unauthorized",
      });

      await expect(retryAuthOperation(operation)).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling in retry operations", () => {
    test("should handle operations that throw non-Error objects", async () => {
      const operation = jest.fn().mockRejectedValue("string error");

      await expect(retryWithBackoff(operation)).rejects.toBe("string error");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test("should handle operations that return undefined", async () => {
      const operation = jest.fn().mockResolvedValue(undefined);

      const result = await retryWithBackoff(operation);

      expect(result).toBeUndefined();
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test("should preserve error properties in final rejection", async () => {
      const customError = new Error("Custom error");
      customError.statusCode = 500;
      customError.customProperty = "test";

      const operation = jest.fn().mockRejectedValue(customError);

      jest.spyOn(global, "setTimeout").mockImplementation((fn) => fn());

      try {
        await retryWithBackoff(operation, { maxRetries: 1 });
      } catch (error) {
        expect(error.statusCode).toBe(500);
        expect(error.customProperty).toBe("test");
      }

      global.setTimeout.mockRestore();
    });
  });

  describe("timing and delays", () => {
    test("should wait appropriate time between retries", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("ENOTFOUND"))
        .mockResolvedValueOnce("success");

      const setTimeoutSpy = jest.spyOn(global, "setTimeout");
      let timeoutDelay;
      setTimeoutSpy.mockImplementation((fn, delay) => {
        timeoutDelay = delay;
        fn();
      });

      await retryWithBackoff(operation, {
        baseDelay: 1000,
        useJitter: false,
      });

      expect(timeoutDelay).toBe(1000); // First retry should be base delay

      setTimeoutSpy.mockRestore();
    });

    test("should handle Promise-based delays correctly", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error("ENOTFOUND"))
        .mockResolvedValueOnce("success");

      const startTime = Date.now();

      // Use actual setTimeout for this test
      const result = await retryWithBackoff(operation, {
        baseDelay: 100, // Small delay for test speed
        useJitter: false,
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result).toBe("success");
      expect(duration).toBeGreaterThan(90); // Should have waited at least 100ms
    });
  });
});
