/**
 * Spotify Authentication Command
 *
 * Handles the 'spotify-organizer auth' CLI command
 */

const chalk = require("chalk");
const SpotifyAuth = require("../lib/auth");
const ErrorHandler = require("../utils/errorHandler");
const RetryHandler = require("../utils/retryHandler");

/**
 * Execute the authentication command
 */
async function authCommand(options = {}) {
  try {
    console.log(chalk.blue("🎵 Spotify Organizer - Authentication"));
    console.log(
      chalk.gray("This will authenticate your account with Spotify.\n")
    );

    // Check if environment variables are set
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      const configError = new Error(
        "Missing required environment variables: SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET"
      );
      ErrorHandler.handleConfigError(configError, "Environment Setup");
      return { success: false, error: "Missing credentials" };
    }

    // Initialize authentication
    const auth = new SpotifyAuth();

    // Perform authentication with retry logic
    const tokens = await RetryHandler.retryAuth(
      () => auth.authenticate(),
      "OAuth Authentication"
    );

    // Test the authentication by getting user profile
    const spotifyApi = auth.getSpotifyApi();
    const userProfile = await spotifyApi.getMe();

    console.log(
      chalk.green(
        `\n✅ Successfully authenticated as: ${userProfile.body.display_name}`
      )
    );
    console.log(chalk.gray(`User ID: ${userProfile.body.id}`));
    console.log(chalk.gray(`Country: ${userProfile.body.country}`));
    console.log(chalk.gray(`Followers: ${userProfile.body.followers.total}`));

    // Show storage information
    const storageInfo = auth.getStorageInfo();
    console.log(
      chalk.blue(`\n🔐 Tokens stored using: ${storageInfo.preferredMethod}`)
    );
    console.log(chalk.gray(`Storage location: ${storageInfo.configDir}`));
    console.log(
      chalk.white(
        "Next steps: Tokens will persist across sessions. Run other commands!\n"
      )
    );

    return {
      success: true,
      tokens,
      userProfile: userProfile.body,
    };
  } catch (error) {
    // Use comprehensive error handling
    const errorInfo = ErrorHandler.handleAuthError(error, "CLI Authentication");

    // Execute any recovery strategies
    await ErrorHandler.executeRecovery(errorInfo, "auth-command");

    return {
      success: false,
      error: error.message,
      errorInfo,
    };
  }
}

module.exports = authCommand;
