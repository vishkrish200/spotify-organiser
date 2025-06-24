const SpotifyAuth = require("../../src/lib/auth");
const TokenStorage = require("../../src/lib/tokenStorage");

// Mock dependencies
jest.mock("../../src/lib/tokenStorage");
jest.mock("spotify-web-api-node", () => {
  return jest.fn().mockImplementation(() => ({
    setClientId: jest.fn(),
    setClientSecret: jest.fn(),
    setAccessToken: jest.fn(),
    setRefreshToken: jest.fn(),
    getMe: jest.fn(),
    authorizationCodeGrant: jest.fn(),
    refreshAccessToken: jest.fn(),
    requestDeviceAuthorization: jest.fn(),
    requestDeviceToken: jest.fn(),
  }));
});

describe("SpotifyAuth", () => {
  let spotifyAuth;
  let mockTokenStorage;
  let mockSpotifyApi;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock TokenStorage
    mockTokenStorage = {
      loadTokens: jest.fn(),
      saveTokens: jest.fn(),
      deleteTokens: jest.fn(),
      hasValidTokens: jest.fn(),
      validateToken: jest.fn(),
    };
    TokenStorage.mockImplementation(() => mockTokenStorage);

    // Set up environment variables
    process.env.SPOTIFY_CLIENT_ID = "test_client_id";
    process.env.SPOTIFY_CLIENT_SECRET = "test_client_secret";
    process.env.SPOTIFY_REDIRECT_URI = "http://localhost:3000/callback";

    spotifyAuth = new SpotifyAuth();
    mockSpotifyApi = spotifyAuth.spotifyApi;
  });

  describe("Constructor", () => {
    test("should initialize with environment variables", () => {
      expect(spotifyAuth.clientId).toBe("test_client_id");
      expect(spotifyAuth.clientSecret).toBe("test_client_secret");
      expect(spotifyAuth.redirectUri).toBe("http://localhost:3000/callback");
    });

    test("should throw error if required environment variables are missing", () => {
      delete process.env.SPOTIFY_CLIENT_ID;
      expect(() => new SpotifyAuth()).toThrow(
        "Missing required environment variables"
      );
    });

    test("should initialize TokenStorage", () => {
      expect(TokenStorage).toHaveBeenCalled();
    });
  });

  describe("authenticate", () => {
    test("should use existing valid tokens if available", async () => {
      const mockTokens = {
        accessToken: "valid_access_token",
        refreshToken: "valid_refresh_token",
        expiresIn: 3600,
        createdAt: Date.now(),
      };

      mockTokenStorage.loadTokens.mockResolvedValue(mockTokens);
      mockTokenStorage.hasValidTokens.mockReturnValue("valid");

      const result = await spotifyAuth.authenticate();

      expect(result).toEqual(mockTokens);
      expect(mockSpotifyApi.setAccessToken).toHaveBeenCalledWith(
        "valid_access_token"
      );
      expect(mockSpotifyApi.setRefreshToken).toHaveBeenCalledWith(
        "valid_refresh_token"
      );
    });

    test("should refresh expired tokens if refresh token exists", async () => {
      const expiredTokens = {
        accessToken: "expired_access_token",
        refreshToken: "valid_refresh_token",
        expiresIn: 3600,
        createdAt: Date.now() - 7200000, // 2 hours ago
      };

      const refreshedTokens = {
        access_token: "new_access_token",
        refresh_token: "new_refresh_token",
        expires_in: 3600,
      };

      mockTokenStorage.loadTokens.mockResolvedValue(expiredTokens);
      mockTokenStorage.hasValidTokens.mockReturnValue("needsRefresh");
      mockSpotifyApi.refreshAccessToken.mockResolvedValue({
        body: refreshedTokens,
      });

      const result = await spotifyAuth.authenticate();

      expect(mockSpotifyApi.refreshAccessToken).toHaveBeenCalled();
      expect(mockTokenStorage.saveTokens).toHaveBeenCalledWith({
        accessToken: "new_access_token",
        refreshToken: "new_refresh_token",
        expiresIn: 3600,
        createdAt: expect.any(Number),
      });
    });

    test("should initiate Device Flow if no valid tokens exist", async () => {
      mockTokenStorage.loadTokens.mockResolvedValue(null);
      mockTokenStorage.hasValidTokens.mockReturnValue("invalid");

      const deviceAuthResponse = {
        body: {
          device_code: "test_device_code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://accounts.spotify.com/activate",
          verification_uri_complete:
            "https://accounts.spotify.com/activate?user_code=ABCD-EFGH",
          expires_in: 600,
          interval: 5,
        },
      };

      const tokenResponse = {
        body: {
          access_token: "new_access_token",
          refresh_token: "new_refresh_token",
          expires_in: 3600,
          token_type: "Bearer",
        },
      };

      mockSpotifyApi.requestDeviceAuthorization.mockResolvedValue(
        deviceAuthResponse
      );
      mockSpotifyApi.requestDeviceToken.mockResolvedValue(tokenResponse);

      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const result = await spotifyAuth.authenticate();

      expect(mockSpotifyApi.requestDeviceAuthorization).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("ABCD-EFGH")
      );
      expect(mockTokenStorage.saveTokens).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("deviceFlow", () => {
    test("should handle authorization_pending during polling", async () => {
      const deviceCode = "test_device_code";
      const interval = 1; // 1 second for testing

      // First call returns authorization_pending, second call succeeds
      mockSpotifyApi.requestDeviceToken
        .mockRejectedValueOnce({
          body: { error: "authorization_pending" },
        })
        .mockResolvedValueOnce({
          body: {
            access_token: "new_access_token",
            refresh_token: "new_refresh_token",
            expires_in: 3600,
          },
        });

      const result = await spotifyAuth.deviceFlow(deviceCode, interval);

      expect(mockSpotifyApi.requestDeviceToken).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        access_token: "new_access_token",
        refresh_token: "new_refresh_token",
        expires_in: 3600,
      });
    });

    test("should handle slow_down error by increasing interval", async () => {
      const deviceCode = "test_device_code";
      const interval = 1;

      mockSpotifyApi.requestDeviceToken
        .mockRejectedValueOnce({
          body: { error: "slow_down" },
        })
        .mockResolvedValueOnce({
          body: {
            access_token: "new_access_token",
            refresh_token: "new_refresh_token",
            expires_in: 3600,
          },
        });

      const result = await spotifyAuth.deviceFlow(deviceCode, interval);

      expect(result).toBeDefined();
    });

    test("should throw error for expired_token", async () => {
      const deviceCode = "test_device_code";
      const interval = 1;

      mockSpotifyApi.requestDeviceToken.mockRejectedValue({
        body: { error: "expired_token" },
      });

      await expect(
        spotifyAuth.deviceFlow(deviceCode, interval)
      ).rejects.toThrow("expired");
    });

    test("should throw error for access_denied", async () => {
      const deviceCode = "test_device_code";
      const interval = 1;

      mockSpotifyApi.requestDeviceToken.mockRejectedValue({
        body: { error: "access_denied" },
      });

      await expect(
        spotifyAuth.deviceFlow(deviceCode, interval)
      ).rejects.toThrow("denied");
    });
  });

  describe("refreshAccessToken", () => {
    test("should successfully refresh tokens", async () => {
      const refreshedTokens = {
        access_token: "new_access_token",
        refresh_token: "new_refresh_token",
        expires_in: 3600,
      };

      mockSpotifyApi.refreshAccessToken.mockResolvedValue({
        body: refreshedTokens,
      });

      const result = await spotifyAuth.refreshAccessToken();

      expect(mockSpotifyApi.refreshAccessToken).toHaveBeenCalled();
      expect(mockTokenStorage.saveTokens).toHaveBeenCalledWith({
        accessToken: "new_access_token",
        refreshToken: "new_refresh_token",
        expiresIn: 3600,
        createdAt: expect.any(Number),
      });
      expect(result).toEqual({
        accessToken: "new_access_token",
        refreshToken: "new_refresh_token",
        expiresIn: 3600,
        createdAt: expect.any(Number),
      });
    });

    test("should handle refresh token errors", async () => {
      mockSpotifyApi.refreshAccessToken.mockRejectedValue(
        new Error("Invalid refresh token")
      );

      await expect(spotifyAuth.refreshAccessToken()).rejects.toThrow(
        "Invalid refresh token"
      );
    });
  });

  describe("validateToken", () => {
    test("should return true for valid token", async () => {
      mockSpotifyApi.getMe.mockResolvedValue({
        body: { id: "test_user", display_name: "Test User" },
      });

      const result = await spotifyAuth.validateToken();

      expect(result).toBe(true);
      expect(mockSpotifyApi.getMe).toHaveBeenCalled();
    });

    test("should return false for invalid token", async () => {
      mockSpotifyApi.getMe.mockRejectedValue(new Error("Invalid token"));

      const result = await spotifyAuth.validateToken();

      expect(result).toBe(false);
    });
  });

  describe("logout", () => {
    test("should clear tokens from storage", async () => {
      mockTokenStorage.deleteTokens.mockResolvedValue();

      await spotifyAuth.logout();

      expect(mockTokenStorage.deleteTokens).toHaveBeenCalled();
    });
  });

  describe("getUserProfile", () => {
    test("should return user profile", async () => {
      const userProfile = {
        id: "test_user",
        display_name: "Test User",
        email: "test@example.com",
      };

      mockSpotifyApi.getMe.mockResolvedValue({ body: userProfile });

      const result = await spotifyAuth.getUserProfile();

      expect(result).toEqual(userProfile);
      expect(mockSpotifyApi.getMe).toHaveBeenCalled();
    });
  });
});
