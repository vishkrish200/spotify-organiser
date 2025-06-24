/**
 * Rollback Manager Test
 *
 * Tests the RollbackManager functionality including session management,
 * operation logging, data retrieval, and cleanup operations.
 */

const chalk = require("chalk");
const RollbackManager = require("../lib/rollbackManager");

class RollbackManagerTest {
  constructor() {
    this.rollbackManager = new RollbackManager();
  }

  /**
   * Run all rollback manager tests
   */
  async runTests() {
    console.log(chalk.cyan("🔄 Starting Rollback Manager Tests\n"));

    try {
      // Test 1: Initialization
      console.log(chalk.blue("1. Testing Initialization"));
      await this.testInitialization();

      // Test 2: Session Management
      console.log(chalk.blue("\n2. Testing Session Management"));
      await this.testSessionManagement();

      // Test 3: Operation Logging
      console.log(chalk.blue("\n3. Testing Operation Logging"));
      await this.testOperationLogging();

      // Test 4: Data Retrieval
      console.log(chalk.blue("\n4. Testing Data Retrieval"));
      await this.testDataRetrieval();

      // Test 5: Statistics
      console.log(chalk.blue("\n5. Testing Statistics"));
      await this.testStatistics();

      // Test 6: Session Cleanup
      console.log(chalk.blue("\n6. Testing Session Cleanup"));
      await this.testSessionCleanup();

      console.log(chalk.green("\n✅ All Rollback Manager tests passed!"));
    } catch (error) {
      console.error(chalk.red(`\n❌ Test failed: ${error.message}`));
      console.error(error.stack);
    } finally {
      await this.rollbackManager.cleanup();
    }
  }

  /**
   * Test initialization
   */
  async testInitialization() {
    console.log("   📋 Initializing RollbackManager...");

    await this.rollbackManager.initialize();

    if (!this.rollbackManager.isInitialized) {
      throw new Error("RollbackManager failed to initialize");
    }

    console.log(chalk.green("   ✅ Initialization successful"));
  }

  /**
   * Test session management
   */
  async testSessionManagement() {
    console.log("   📋 Testing session creation...");

    // Create a new session
    const session1 = await this.rollbackManager.createSession(
      "generation",
      "test_user_123",
      30 // 30 days expiry
    );

    if (!session1.id || session1.sessionType !== "generation") {
      throw new Error("Session creation failed");
    }

    console.log(`   ✅ Created session: ${session1.id}`);

    // Test ending session
    console.log("   📋 Testing session ending...");
    await this.rollbackManager.endSession();

    if (this.rollbackManager.currentSession !== null) {
      throw new Error("Session should be null after ending");
    }

    console.log("   ✅ Session ended successfully");

    // Create another session for subsequent tests
    const session2 = await this.rollbackManager.createSession(
      "generation",
      "test_user_123"
    );

    console.log(`   ✅ Created second session: ${session2.id}`);
  }

  /**
   * Test operation logging
   */
  async testOperationLogging() {
    console.log("   📋 Logging playlist creation operation...");

    const playlistOperation = await this.rollbackManager.logOperation(
      "create_playlist",
      "playlist",
      "spotify_playlist_123",
      {
        name: "🎵 Rock Classics",
        description: "Classic rock tracks from the 70s and 80s",
        tracks: ["track1", "track2", "track3"],
        isPublic: false,
      }
    );

    if (
      !playlistOperation.id ||
      playlistOperation.operationType !== "create_playlist"
    ) {
      throw new Error("Playlist operation logging failed");
    }

    console.log(`   ✅ Logged playlist operation: ${playlistOperation.id}`);

    console.log("   📋 Logging track addition operation...");

    const trackOperation = await this.rollbackManager.logOperation(
      "add_tracks",
      "track",
      "spotify_track_456",
      {
        playlistId: "spotify_playlist_123",
        tracks: ["track4", "track5"],
        position: 3,
      }
    );

    if (!trackOperation.id || trackOperation.operationType !== "add_tracks") {
      throw new Error("Track operation logging failed");
    }

    console.log(`   ✅ Logged track operation: ${trackOperation.id}`);
  }

  /**
   * Test data retrieval
   */
  async testDataRetrieval() {
    console.log("   📋 Testing active sessions retrieval...");

    const activeSessions = await this.rollbackManager.getActiveSessions(
      "test_user_123"
    );

    if (!Array.isArray(activeSessions) || activeSessions.length === 0) {
      throw new Error("Should have at least one active session");
    }

    console.log(`   ✅ Found ${activeSessions.length} active session(s)`);

    console.log("   📋 Testing last session retrieval...");

    const lastSession = await this.rollbackManager.getLastSession(
      "test_user_123"
    );

    if (!lastSession || !lastSession.id) {
      throw new Error("Should have a last session");
    }

    if (!lastSession.operations || lastSession.operations.length === 0) {
      throw new Error("Last session should have operations");
    }

    console.log(
      `   ✅ Last session: ${lastSession.id} with ${lastSession.operations.length} operations`
    );

    console.log("   📋 Testing session retrieval by ID...");

    const sessionById = await this.rollbackManager.getSession(lastSession.id);

    if (!sessionById || sessionById.id !== lastSession.id) {
      throw new Error("Session retrieval by ID failed");
    }

    console.log(`   ✅ Retrieved session by ID: ${sessionById.id}`);
  }

  /**
   * Test statistics
   */
  async testStatistics() {
    console.log("   📋 Testing statistics generation...");

    const stats = await this.rollbackManager.getStats("test_user_123");

    if (typeof stats.totalSessions !== "number" || stats.totalSessions === 0) {
      throw new Error("Statistics should show sessions");
    }

    if (typeof stats.totalPlaylistsCreated !== "number") {
      throw new Error("Statistics should include playlist count");
    }

    console.log("   📊 Statistics:");
    console.log(`      - Total Sessions: ${stats.totalSessions}`);
    console.log(`      - Active Sessions: ${stats.activeSessions}`);
    console.log(`      - Rolled Back Sessions: ${stats.rolledBackSessions}`);
    console.log(
      `      - Total Playlists Created: ${stats.totalPlaylistsCreated}`
    );
    console.log(`      - Total Tracks Affected: ${stats.totalTracksAffected}`);

    console.log("   ✅ Statistics generation successful");
  }

  /**
   * Test session cleanup
   */
  async testSessionCleanup() {
    console.log("   📋 Testing rollback marking...");

    const lastSession = await this.rollbackManager.getLastSession(
      "test_user_123"
    );

    if (lastSession) {
      await this.rollbackManager.markSessionRolledBack(
        lastSession.id,
        "Test rollback operation"
      );

      const rolledBackSession = await this.rollbackManager.getSession(
        lastSession.id
      );

      if (rolledBackSession.status !== "rolled_back") {
        throw new Error("Session should be marked as rolled back");
      }

      console.log(`   ✅ Marked session ${lastSession.id} as rolled back`);
    }

    console.log("   📋 Testing expired session cleanup...");

    const cleanedCount = await this.rollbackManager.cleanupExpiredSessions();

    console.log(`   ✅ Cleaned up ${cleanedCount} expired sessions`);
  }

  /**
   * Display rollback data summary
   */
  async displaySummary() {
    console.log(chalk.cyan("\n📊 Rollback Manager Test Summary"));
    console.log("━".repeat(50));

    const stats = await this.rollbackManager.getStats();
    const activeSessions = await this.rollbackManager.getActiveSessions();

    console.log(`Total Sessions Created: ${stats.totalSessions}`);
    console.log(`Active Sessions: ${stats.activeSessions}`);
    console.log(`Rolled Back Sessions: ${stats.rolledBackSessions}`);
    console.log(`Total Playlists Created: ${stats.totalPlaylistsCreated}`);
    console.log(`Total Tracks Affected: ${stats.totalTracksAffected}`);

    if (activeSessions.length > 0) {
      console.log(chalk.cyan("\nActive Sessions:"));
      activeSessions.forEach((session, index) => {
        console.log(`${index + 1}. Session ${session.id}`);
        console.log(`   Type: ${session.sessionType}`);
        console.log(`   User: ${session.spotifyUserId}`);
        console.log(
          `   Started: ${new Date(session.startTime).toLocaleString()}`
        );
        console.log(`   Operations: ${session.operations?.length || 0}`);
        console.log(
          `   Expires: ${new Date(session.expiryTime).toLocaleString()}`
        );
      });
    }
  }
}

/**
 * Main test execution
 */
async function runRollbackManagerTests() {
  const test = new RollbackManagerTest();
  await test.runTests();
  await test.displaySummary();
}

// Run tests if this file is executed directly
if (require.main === module) {
  runRollbackManagerTests().catch((error) => {
    console.error(chalk.red("Test execution failed:"), error);
    process.exit(1);
  });
}

module.exports = { RollbackManagerTest, runRollbackManagerTests };
