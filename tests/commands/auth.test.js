const { authCommand } = require("../../src/commands/auth");
const SpotifyAuth = require("../../src/lib/auth");
const { handleError } = require("../../src/utils/errorHandler");

// Mock dependencies
jest.mock("../../src/lib/auth");
jest.mock("../../src/utils/errorHandler");
jest.mock("chalk", () => ({
  green: jest.fn((str) => `GREEN(${str})`),
  blue: jest.fn((str) => `BLUE(${str})`),
  yellow: jest.fn((str) => `YELLOW(${str})`),
  red: jest.fn((str) => `RED(${str})`),
  cyan: jest.fn((str) => `CYAN(${str})`),
  bold: jest.fn((str) => `BOLD(${str})`),
  dim: jest.fn((str) => `DIM(${str})`),
}));

describe("Auth Command", () => {
  let mockSpotifyAuth;
  let consoleSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock SpotifyAuth
    mockSpotifyAuth = {
      authenticate: jest.fn(),
      getUserProfile: jest.fn(),
      tokenStorage: {
        getStorageMethod: jest.fn(),
      },
    };
    SpotifyAuth.mockImplementation(() => mockSpotifyAuth);

    // Mock console methods
    consoleSpy = {
      log: jest.spyOn(console, "log").mockImplementation(),
      error: jest.spyOn(console, "error").mockImplementation(),
    };

    // Set up environment variables
    process.env.SPOTIFY_CLIENT_ID = "test_client_id";
    process.env.SPOTIFY_CLIENT_SECRET = "test_client_secret";
    process.env.SPOTIFY_REDIRECT_URI = "http://localhost:3000/callback";
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe("Environment Validation", () => {
    test("should validate required environment variables", async () => {
      delete process.env.SPOTIFY_CLIENT_ID;

      await authCommand();

      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("environment variables"),
        }),
        "configuration"
      );
    });

    test("should proceed with valid environment variables", async () => {
      const mockTokens = {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresIn: 3600,
      };

      const mockProfile = {
        id: "test_user",
        display_name: "Test User",
        email: "test@example.com",
      };

      mockSpotifyAuth.authenticate.mockResolvedValue(mockTokens);
      mockSpotifyAuth.getUserProfile.mockResolvedValue(mockProfile);
      mockSpotifyAuth.tokenStorage.getStorageMethod.mockReturnValue(
        "System Keychain (secure)"
      );

      await authCommand();

      expect(SpotifyAuth).toHaveBeenCalled();
      expect(mockSpotifyAuth.authenticate).toHaveBeenCalled();
    });
  });

  describe("Authentication Flow", () => {
    beforeEach(() => {
      // Ensure environment is set up
      process.env.SPOTIFY_CLIENT_ID = "test_client_id";
      process.env.SPOTIFY_CLIENT_SECRET = "test_client_secret";
      process.env.SPOTIFY_REDIRECT_URI = "http://localhost:3000/callback";
    });

    test("should successfully authenticate and display user profile", async () => {
      const mockTokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
      };

      const mockProfile = {
        id: "spotify_user_123",
        display_name: "John Doe",
        email: "john@example.com",
      };

      mockSpotifyAuth.authenticate.mockResolvedValue(mockTokens);
      mockSpotifyAuth.getUserProfile.mockResolvedValue(mockProfile);
      mockSpotifyAuth.tokenStorage.getStorageMethod.mockReturnValue(
        "System Keychain (secure)"
      );

      await authCommand();

      expect(mockSpotifyAuth.authenticate).toHaveBeenCalled();
      expect(mockSpotifyAuth.getUserProfile).toHaveBeenCalled();

      // Check success messages
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Authentication successful")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("John Doe")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("spotify_user_123")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("john@example.com")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("System Keychain")
      );
    });

    test("should handle authentication with missing display name", async () => {
      const mockTokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
      };

      const mockProfile = {
        id: "spotify_user_123",
        email: "john@example.com",
        // display_name is missing
      };

      mockSpotifyAuth.authenticate.mockResolvedValue(mockTokens);
      mockSpotifyAuth.getUserProfile.mockResolvedValue(mockProfile);
      mockSpotifyAuth.tokenStorage.getStorageMethod.mockReturnValue(
        "Encrypted File (AES-256)"
      );

      await authCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("spotify_user_123")
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Encrypted File")
      );
    });

    test("should handle authentication failure", async () => {
      const authError = new Error("Authentication failed");
      mockSpotifyAuth.authenticate.mockRejectedValue(authError);

      await authCommand();

      expect(handleError).toHaveBeenCalledWith(authError, "authentication");
    });

    test("should handle user profile fetch failure", async () => {
      const mockTokens = {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresIn: 3600,
      };

      const profileError = new Error("Profile fetch failed");

      mockSpotifyAuth.authenticate.mockResolvedValue(mockTokens);
      mockSpotifyAuth.getUserProfile.mockRejectedValue(profileError);

      await authCommand();

      expect(handleError).toHaveBeenCalledWith(profileError, "authentication");
    });
  });

  describe("Error Scenarios", () => {
    test("should handle SpotifyAuth initialization failure", async () => {
      SpotifyAuth.mockImplementation(() => {
        throw new Error("Initialization failed");
      });

      await authCommand();

      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Initialization failed",
        }),
        "authentication"
      );
    });

    test("should handle missing environment variables gracefully", async () => {
      delete process.env.SPOTIFY_CLIENT_ID;
      delete process.env.SPOTIFY_CLIENT_SECRET;
      delete process.env.SPOTIFY_REDIRECT_URI;

      await authCommand();

      expect(handleError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("environment variables"),
        }),
        "configuration"
      );
    });

    test("should handle network errors during authentication", async () => {
      const networkError = new Error("Network error");
      networkError.code = "ENOTFOUND";

      mockSpotifyAuth.authenticate.mockRejectedValue(networkError);

      await authCommand();

      expect(handleError).toHaveBeenCalledWith(networkError, "authentication");
    });

    test("should handle OAuth errors", async () => {
      const oauthError = new Error("OAuth error");
      oauthError.statusCode = 400;
      oauthError.body = { error: "invalid_request" };

      mockSpotifyAuth.authenticate.mockRejectedValue(oauthError);

      await authCommand();

      expect(handleError).toHaveBeenCalledWith(oauthError, "authentication");
    });
  });

  describe("Output Formatting", () => {
    test("should display authentication instructions clearly", async () => {
      const mockTokens = {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresIn: 3600,
      };

      const mockProfile = {
        id: "test_user",
        display_name: "Test User",
        email: "test@example.com",
      };

      mockSpotifyAuth.authenticate.mockResolvedValue(mockTokens);
      mockSpotifyAuth.getUserProfile.mockResolvedValue(mockProfile);
      mockSpotifyAuth.tokenStorage.getStorageMethod.mockReturnValue(
        "System Keychain (secure)"
      );

      await authCommand();

      // Check that intro message is displayed
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Spotify Authentication")
      );

      // Check that steps are displayed
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("1.")
      );
    });

    test("should use colored output for better UX", async () => {
      const mockTokens = { accessToken: "test-token" };
      const mockProfile = { id: "test_user", display_name: "Test User" };

      mockSpotifyAuth.authenticate.mockResolvedValue(mockTokens);
      mockSpotifyAuth.getUserProfile.mockResolvedValue(mockProfile);
      mockSpotifyAuth.tokenStorage.getStorageMethod.mockReturnValue(
        "System Keychain (secure)"
      );

      const chalk = require("chalk");

      await authCommand();

      // Verify chalk methods were called (mocked)
      expect(chalk.green).toHaveBeenCalled();
      expect(chalk.blue).toHaveBeenCalled();
      expect(chalk.bold).toHaveBeenCalled();
    });
  });

  describe("Integration Scenarios", () => {
    test("should handle complete flow with token refresh", async () => {
      // Simulate expired tokens that get refreshed
      const refreshedTokens = {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
      };

      const mockProfile = {
        id: "test_user",
        display_name: "Test User",
        email: "test@example.com",
      };

      mockSpotifyAuth.authenticate.mockResolvedValue(refreshedTokens);
      mockSpotifyAuth.getUserProfile.mockResolvedValue(mockProfile);
      mockSpotifyAuth.tokenStorage.getStorageMethod.mockReturnValue(
        "System Keychain (secure)"
      );

      await authCommand();

      expect(mockSpotifyAuth.authenticate).toHaveBeenCalled();
      expect(mockSpotifyAuth.getUserProfile).toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("successful")
      );
    });

    test("should handle storage method information display", async () => {
      const mockTokens = { accessToken: "test-token" };
      const mockProfile = { id: "test_user" };

      mockSpotifyAuth.authenticate.mockResolvedValue(mockTokens);
      mockSpotifyAuth.getUserProfile.mockResolvedValue(mockProfile);
      mockSpotifyAuth.tokenStorage.getStorageMethod.mockReturnValue(
        "Encrypted File (AES-256)"
      );

      await authCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("Token Storage: Encrypted File (AES-256)")
      );
    });
  });
});
