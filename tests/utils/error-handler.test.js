const {
  handleError,
  categorizeError,
  getRecoveryStrategy,
} = require("../../src/utils/errorHandler");

// Mock chalk for colored output
jest.mock("chalk", () => ({
  red: jest.fn((str) => `RED(${str})`),
  yellow: jest.fn((str) => `YELLOW(${str})`),
  blue: jest.fn((str) => `BLUE(${str})`),
  green: jest.fn((str) => `GREEN(${str})`),
  bold: jest.fn((str) => `BOLD(${str})`),
  dim: jest.fn((str) => `DIM(${str})`),
}));

describe("Error Handler", () => {
  let consoleSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = {
      log: jest.spyOn(console, "log").mockImplementation(),
      error: jest.spyOn(console, "error").mockImplementation(),
    };
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe("categorizeError", () => {
    test("should categorize network errors correctly", () => {
      const networkError = new Error("Network error");
      networkError.code = "ENOTFOUND";

      const category = categorizeError(networkError);

      expect(category).toBe("network");
    });

    test("should categorize authentication errors correctly", () => {
      const authError = new Error("OAuth error");
      authError.statusCode = 401;

      const category = categorizeError(authError);

      expect(category).toBe("authentication");
    });

    test("should categorize configuration errors correctly", () => {
      const configError = new Error("Missing required environment variables");

      const category = categorizeError(configError);

      expect(category).toBe("configuration");
    });

    test("should categorize storage errors correctly", () => {
      const storageError = new Error("Keychain access denied");

      const category = categorizeError(storageError);

      expect(category).toBe("storage");
    });

    test("should categorize Spotify API errors by status code", () => {
      const apiError = new Error("Bad Request");
      apiError.statusCode = 400;

      const category = categorizeError(apiError);

      expect(category).toBe("spotify_api");
    });

    test("should categorize rate limit errors correctly", () => {
      const rateLimitError = new Error("Rate limited");
      rateLimitError.statusCode = 429;

      const category = categorizeError(rateLimitError);

      expect(category).toBe("rate_limit");
    });

    test("should default to general category for unknown errors", () => {
      const unknownError = new Error("Unknown error");

      const category = categorizeError(unknownError);

      expect(category).toBe("general");
    });
  });

  describe("getRecoveryStrategy", () => {
    test("should provide network recovery strategy", () => {
      const strategy = getRecoveryStrategy("network");

      expect(strategy).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Check your internet connection"),
          expect.stringContaining("Try again in a few moments"),
          expect.stringContaining("VPN or proxy"),
        ])
      );
    });

    test("should provide authentication recovery strategy", () => {
      const strategy = getRecoveryStrategy("authentication");

      expect(strategy).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Verify your Spotify app credentials"),
          expect.stringContaining("Check that your Spotify app"),
          expect.stringContaining("Ensure your Spotify account"),
        ])
      );
    });

    test("should provide configuration recovery strategy", () => {
      const strategy = getRecoveryStrategy("configuration");

      expect(strategy).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Set the required environment variables"),
          expect.stringContaining("SPOTIFY_CLIENT_ID"),
          expect.stringContaining("Check the env-setup.md"),
        ])
      );
    });

    test("should provide storage recovery strategy", () => {
      const strategy = getRecoveryStrategy("storage");

      expect(strategy).toEqual(
        expect.arrayContaining([
          expect.stringContaining("keychain access"),
          expect.stringContaining("file system permissions"),
          expect.stringContaining("Run the command with administrator"),
        ])
      );
    });

    test("should provide rate limit recovery strategy", () => {
      const strategy = getRecoveryStrategy("rate_limit");

      expect(strategy).toEqual(
        expect.arrayContaining([
          expect.stringContaining("You are making requests too quickly"),
          expect.stringContaining("Wait a few minutes"),
          expect.stringContaining("automatically retry"),
        ])
      );
    });

    test("should provide default recovery strategy for unknown categories", () => {
      const strategy = getRecoveryStrategy("unknown_category");

      expect(strategy).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Try running the command again"),
          expect.stringContaining("Check your internet connection"),
          expect.stringContaining("restart the application"),
        ])
      );
    });
  });

  describe("handleError", () => {
    test("should handle network errors with proper formatting", () => {
      const networkError = new Error("ENOTFOUND spotify.com");
      networkError.code = "ENOTFOUND";

      handleError(networkError, "network");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Network Error")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Check your internet connection")
      );
    });

    test("should handle authentication errors with specific guidance", () => {
      const authError = new Error("Invalid credentials");
      authError.statusCode = 401;

      handleError(authError, "authentication");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Authentication Error")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Verify your Spotify app credentials")
      );
    });

    test("should handle configuration errors with setup instructions", () => {
      const configError = new Error("Missing SPOTIFY_CLIENT_ID");

      handleError(configError, "configuration");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Configuration Error")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("SPOTIFY_CLIENT_ID")
      );
    });

    test("should handle storage errors with permission guidance", () => {
      const storageError = new Error("Keychain access denied");

      handleError(storageError, "storage");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Storage Error")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("keychain access")
      );
    });

    test("should handle rate limit errors with wait instructions", () => {
      const rateLimitError = new Error("Rate limited");
      rateLimitError.statusCode = 429;

      handleError(rateLimitError, "rate_limit");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Rate Limit")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Wait a few minutes")
      );
    });

    test("should auto-categorize errors when context not provided", () => {
      const networkError = new Error("Connection refused");
      networkError.code = "ECONNREFUSED";

      handleError(networkError);

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Network Error")
      );
    });

    test("should include error details in output", () => {
      const detailedError = new Error("Detailed error message");
      detailedError.statusCode = 500;
      detailedError.body = {
        error: "internal_server_error",
        error_description: "Something went wrong",
      };

      handleError(detailedError, "spotify_api");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Detailed error message")
      );
    });

    test("should handle OAuth specific errors", () => {
      const oauthError = new Error("OAuth error");
      oauthError.body = {
        error: "access_denied",
        error_description: "User denied access",
      };

      handleError(oauthError, "authentication");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("Authentication Error")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Verify your Spotify app credentials")
      );
    });

    test("should provide formatted output with colors", () => {
      const error = new Error("Test error");

      handleError(error, "general");

      const chalk = require("chalk");
      expect(chalk.red).toHaveBeenCalled();
      expect(chalk.bold).toHaveBeenCalled();
    });

    test("should handle errors without stack trace gracefully", () => {
      const error = { message: "Error without stack" };

      expect(() => handleError(error, "general")).not.toThrow();
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe("Error Context Detection", () => {
    test("should detect Spotify API errors from status codes", () => {
      const spotifyError = new Error("Spotify API error");
      spotifyError.statusCode = 403;

      const category = categorizeError(spotifyError);

      expect(category).toBe("spotify_api");
    });

    test("should detect keychain errors from error messages", () => {
      const keychainError = new Error("Could not add password to keychain");

      const category = categorizeError(keychainError);

      expect(category).toBe("storage");
    });

    test("should detect environment variable errors", () => {
      const envError = new Error("SPOTIFY_CLIENT_SECRET is not defined");

      const category = categorizeError(envError);

      expect(category).toBe("configuration");
    });

    test("should detect timeout errors", () => {
      const timeoutError = new Error("Request timeout");
      timeoutError.code = "ETIMEDOUT";

      const category = categorizeError(timeoutError);

      expect(category).toBe("network");
    });
  });

  describe("Recovery Strategy Formatting", () => {
    test("should format recovery strategies with numbered steps", () => {
      handleError(new Error("Test error"), "configuration");

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("1.")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("2.")
      );
    });

    test("should include helpful links and references", () => {
      handleError(new Error("Configuration error"), "configuration");

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("env-setup.md")
      );
    });

    test("should provide contextual help based on error type", () => {
      const authError = new Error("Token expired");

      handleError(authError, "authentication");

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Spotify app")
      );
    });
  });
});
