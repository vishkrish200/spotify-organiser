/**
 * Spotify Authentication Module
 *
 * Implements OAuth 2.0 Device Flow with Authorization Code Flow fallback
 * for secure CLI authentication with Spotify Web API
 */

const axios = require("axios");
const chalk = require("chalk");
const SpotifyWebApi = require("spotify-web-api-node");
const TokenStorage = require("./tokenStorage");
require("dotenv").config();

class SpotifyAuth {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    this.redirectUri = "http://127.0.0.1:8888/callback";

    // Required scopes for our application
    this.scopes = [
      "user-library-read",
      "playlist-modify-public",
      "playlist-modify-private",
      "user-read-private",
    ];

    this.spotifyApi = new SpotifyWebApi({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
    });

    // Initialize token storage
    this.tokenStorage = new TokenStorage();
  }

  /**
   * Main authentication method - checks existing tokens first, then authenticates if needed
   */
  async authenticate() {
    console.log(chalk.blue("🔐 Starting Spotify authentication..."));

    // First, check if we have valid existing tokens
    try {
      const tokenCheck = await this.tokenStorage.hasValidTokens();

      if (tokenCheck.valid) {
        console.log(chalk.green("✅ Using existing valid tokens"));
        this.setTokens(tokenCheck.tokens);
        return tokenCheck.tokens;
      } else if (tokenCheck.needsRefresh && tokenCheck.tokens) {
        console.log(chalk.yellow("🔄 Refreshing expired tokens..."));
        try {
          this.setTokens(tokenCheck.tokens);
          const refreshedTokens = await this.refreshAccessToken();
          const updatedTokens = { ...tokenCheck.tokens, ...refreshedTokens };
          await this.tokenStorage.saveTokens(updatedTokens);
          console.log(chalk.green("✅ Tokens refreshed successfully"));
          return updatedTokens;
        } catch (refreshError) {
          console.log(
            chalk.yellow("⚠️  Token refresh failed, re-authenticating...")
          );
        }
      }
    } catch (storageError) {
      console.log(chalk.gray(`Token check failed: ${storageError.message}`));
    }

    // No valid tokens, need to authenticate
    try {
      // Try Device Flow first
      console.log(chalk.gray("Attempting Device Flow authentication..."));
      const tokens = await this.authenticateWithDeviceFlow();

      // Save tokens securely
      await this.tokenStorage.saveTokens(tokens);

      return tokens;
    } catch (deviceFlowError) {
      console.log(
        chalk.yellow(
          "⚠️  Device Flow not available, using Authorization Code Flow..."
        )
      );
      console.log(chalk.gray(`Device Flow error: ${deviceFlowError.message}`));

      // Fallback to Authorization Code Flow
      const tokens = await this.authenticateWithAuthCodeFlow();

      // Save tokens securely
      await this.tokenStorage.saveTokens(tokens);

      return tokens;
    }
  }

  /**
   * OAuth 2.0 Device Flow Implementation
   */
  async authenticateWithDeviceFlow() {
    const scope = this.scopes.join(" ");

    try {
      // Step 1: Request device and user codes
      console.log(chalk.gray("Requesting device authorization..."));
      const deviceResponse = await axios.post(
        "https://accounts.spotify.com/api/device/code",
        {
          client_id: this.clientId,
          scope: scope,
        },
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          transformRequest: [(data) => new URLSearchParams(data).toString()],
        }
      );

      const { device_code, user_code, verification_uri, expires_in, interval } =
        deviceResponse.data;

      // Step 2: Display instructions to user
      this.displayDeviceFlowInstructions(user_code, verification_uri);

      // Step 3: Poll for token
      const tokens = await this.pollForDeviceFlowToken(
        device_code,
        interval,
        expires_in
      );

      // Step 4: Configure SpotifyWebApi with tokens
      this.setTokens(tokens);

      console.log(chalk.green("✅ Device Flow authentication successful!"));
      return tokens;
    } catch (error) {
      if (error.response && error.response.status === 400) {
        throw new Error("Device Flow not supported for this application");
      }
      throw error;
    }
  }

  /**
   * OAuth 2.0 Authorization Code Flow (Fallback)
   */
  async authenticateWithAuthCodeFlow() {
    const authUrl = this.spotifyApi.createAuthorizeURL(
      this.scopes,
      "state-" + Date.now()
    );

    // Display instructions for manual authentication
    console.log(chalk.green("\n📋 Manual Authentication Required:"));
    console.log(chalk.white("1. Open this URL in your browser:"));
    console.log(chalk.cyan(authUrl));
    console.log(chalk.white("2. Authorize the application"));
    console.log(
      chalk.white("3. Copy the entire callback URL from your browser")
    );
    console.log(chalk.white("4. Paste it below when prompted\n"));

    // Prompt user for callback URL
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve, reject) => {
      rl.question(
        chalk.yellow("Paste the callback URL here: "),
        async (callbackUrl) => {
          rl.close();

          try {
            // Extract authorization code from callback URL
            const url = new URL(callbackUrl);
            const code = url.searchParams.get("code");
            const error = url.searchParams.get("error");

            if (error) {
              throw new Error(`Authorization failed: ${error}`);
            }

            if (!code) {
              throw new Error("No authorization code found in callback URL");
            }

            console.log(
              chalk.blue("🔄 Exchanging authorization code for tokens...")
            );

            // Exchange authorization code for tokens
            const data = await this.spotifyApi.authorizationCodeGrant(code);

            const tokens = {
              accessToken: data.body.access_token,
              refreshToken: data.body.refresh_token,
              expiresIn: data.body.expires_in,
              tokenType: data.body.token_type,
            };

            // Set tokens in API instance
            this.setTokens(tokens);

            console.log(
              chalk.green(
                "✅ Authorization Code Flow authentication successful!"
              )
            );
            resolve(tokens);
          } catch (error) {
            console.log(
              chalk.red(`❌ Token exchange failed: ${error.message}`)
            );
            reject(error);
          }
        }
      );
    });
  }

  /**
   * Display Device Flow instructions to user
   */
  displayDeviceFlowInstructions(userCode, verificationUri) {
    console.log(
      chalk.green("\n🌐 Please complete authentication in your browser:")
    );
    console.log(chalk.white("1. Visit: ") + chalk.cyan(verificationUri));
    console.log(chalk.white("2. Enter code: ") + chalk.yellow(userCode));
    console.log(chalk.gray("Waiting for authorization..."));
  }

  /**
   * Poll Spotify token endpoint for Device Flow completion
   */
  async pollForDeviceFlowToken(deviceCode, interval, expiresIn) {
    const startTime = Date.now();
    const expiryTime = startTime + expiresIn * 1000;
    let currentInterval = interval;

    while (Date.now() < expiryTime) {
      await new Promise((resolve) =>
        setTimeout(resolve, currentInterval * 1000)
      );

      try {
        const tokenResponse = await axios.post(
          "https://accounts.spotify.com/api/token",
          {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCode,
            client_id: this.clientId,
          },
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            transformRequest: [(data) => new URLSearchParams(data).toString()],
          }
        );

        return {
          accessToken: tokenResponse.data.access_token,
          refreshToken: tokenResponse.data.refresh_token,
          expiresIn: tokenResponse.data.expires_in,
          tokenType: tokenResponse.data.token_type,
        };
      } catch (error) {
        if (error.response && error.response.data) {
          const errorType = error.response.data.error;

          switch (errorType) {
            case "authorization_pending":
              // Continue polling
              console.log(chalk.gray("."), { newline: false });
              continue;

            case "slow_down":
              // Increase polling interval
              currentInterval += 5;
              console.log(chalk.yellow("⏳ Slowing down polling..."));
              continue;

            case "expired_token":
              throw new Error("Device code expired. Please try again.");

            case "access_denied":
              throw new Error("Authorization denied by user.");

            default:
              throw new Error(`Authentication error: ${errorType}`);
          }
        }
        throw error;
      }
    }

    throw new Error("Device code expired. Please try again.");
  }

  /**
   * Set tokens in SpotifyWebApi instance
   */
  setTokens(tokens) {
    this.spotifyApi.setAccessToken(tokens.accessToken);
    if (tokens.refreshToken) {
      this.spotifyApi.setRefreshToken(tokens.refreshToken);
    }
  }

  /**
   * Get configured SpotifyWebApi instance
   */
  getSpotifyApi() {
    return this.spotifyApi;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    try {
      const data = await this.spotifyApi.refreshAccessToken();
      const accessToken = data.body.access_token;

      this.spotifyApi.setAccessToken(accessToken);

      return {
        accessToken: accessToken,
        expiresIn: data.body.expires_in,
      };
    } catch (error) {
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  /**
   * Validate current access token
   */
  async validateToken() {
    try {
      await this.spotifyApi.getMe();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load existing tokens from storage and set them in the API instance
   */
  async loadStoredTokens() {
    try {
      const tokenCheck = await this.tokenStorage.hasValidTokens();

      if (tokenCheck.valid) {
        this.setTokens(tokenCheck.tokens);
        return tokenCheck.tokens;
      } else if (tokenCheck.needsRefresh && tokenCheck.tokens) {
        this.setTokens(tokenCheck.tokens);
        const refreshedTokens = await this.refreshAccessToken();
        const updatedTokens = { ...tokenCheck.tokens, ...refreshedTokens };
        await this.tokenStorage.saveTokens(updatedTokens);
        return updatedTokens;
      }

      return null;
    } catch (error) {
      console.log(chalk.gray(`Failed to load stored tokens: ${error.message}`));
      return null;
    }
  }

  /**
   * Logout - clear stored tokens
   */
  async logout() {
    try {
      await this.tokenStorage.deleteTokens();

      // Clear tokens from API instance
      this.spotifyApi.setAccessToken(null);
      this.spotifyApi.setRefreshToken(null);

      console.log(chalk.green("✅ Successfully logged out"));
      return { success: true };
    } catch (error) {
      console.log(chalk.red(`❌ Logout failed: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * Get storage information
   */
  getStorageInfo() {
    return this.tokenStorage.getStorageInfo();
  }

  /**
   * Check if user is currently authenticated
   */
  async isAuthenticated() {
    const tokenCheck = await this.tokenStorage.hasValidTokens();
    return tokenCheck.valid || (tokenCheck.needsRefresh && tokenCheck.tokens);
  }
}

module.exports = SpotifyAuth;
