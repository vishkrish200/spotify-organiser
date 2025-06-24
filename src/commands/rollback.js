/**
 * Rollback Command
 *
 * Provides CLI interface for rolling back playlist creation operations.
 * Supports listing available sessions, rolling back specific sessions or
 * the last session, and provides detailed feedback on operations.
 */

const chalk = require("chalk");
const inquirer = require("inquirer");
const RollbackManager = require("../lib/rollbackManager");
const TableDisplay = require("../lib/tableDisplay");
const PlaylistDeletion = require("../lib/playlistDeletion");

class RollbackCommand {
  constructor() {
    this.rollbackManager = new RollbackManager();
    this.tableDisplay = new TableDisplay();
    this.playlistDeletion = new PlaylistDeletion();
  }

  /**
   * Main rollback command handler
   */
  async execute(options = {}) {
    const {
      last = false,
      sessionId = null,
      list = false,
      confirm = false,
      dryRun = false,
      force = false,
    } = options;

    try {
      await this.rollbackManager.initialize();

      console.log(
        this.tableDisplay.createSectionHeader(
          "🔄 Spotify Organizer Rollback",
          dryRun ? "Dry Run Mode - No changes will be made" : "Rollback Mode"
        )
      );

      // Handle list option
      if (list) {
        return await this.listRollbackSessions();
      }

      // Handle rollback operations
      if (last) {
        return await this.rollbackLastSession({ confirm, dryRun, force });
      } else if (sessionId) {
        return await this.rollbackSpecificSession(sessionId, {
          confirm,
          dryRun,
          force,
        });
      } else {
        return await this.interactiveRollback({ confirm, dryRun, force });
      }
    } catch (error) {
      console.error(chalk.red(`❌ Rollback failed: ${error.message}`));
      throw error;
    } finally {
      await this.rollbackManager.cleanup();
    }
  }

  /**
   * List available rollback sessions
   */
  async listRollbackSessions() {
    console.log(chalk.cyan("📋 Retrieving rollback sessions..."));

    try {
      const sessions = await this.rollbackManager.getActiveSessions();

      if (sessions.length === 0) {
        console.log(chalk.yellow("⚠️  No rollback sessions available"));
        console.log(
          chalk.gray(
            "   Run 'spotify-organizer generate' to create playlists first"
          )
        );
        return { sessions: [], count: 0 };
      }

      console.log(
        this.tableDisplay.createSectionHeader(
          "Available Rollback Sessions",
          `${sessions.length} session(s) found`
        )
      );

      // Create sessions table
      const sessionsTable = this.createSessionsTable(sessions);
      console.log(sessionsTable);

      // Show summary statistics
      const stats = await this.rollbackManager.getStats();
      const summaryTable = this.createRollbackSummaryTable(stats);
      console.log(this.tableDisplay.createSectionHeader("Rollback Statistics"));
      console.log(summaryTable);

      return { sessions, count: sessions.length };
    } catch (error) {
      console.error(chalk.red(`❌ Failed to list sessions: ${error.message}`));
      throw error;
    }
  }

  /**
   * Rollback the last session
   */
  async rollbackLastSession(options = {}) {
    const { confirm = false, dryRun = false, force = false } = options;

    console.log(chalk.cyan("🔍 Finding last rollback session..."));

    try {
      const lastSession = await this.rollbackManager.getLastSession();

      if (!lastSession) {
        console.log(chalk.yellow("⚠️  No rollback sessions available"));
        console.log(
          chalk.gray(
            "   Run 'spotify-organizer generate' to create playlists first"
          )
        );
        return { success: false, reason: "no_sessions" };
      }

      console.log(chalk.green(`✅ Found last session: ${lastSession.id}`));
      console.log(
        chalk.gray(
          `   Created: ${new Date(lastSession.startTime).toLocaleString()}`
        )
      );
      console.log(
        chalk.gray(`   Operations: ${lastSession.operations.length}`)
      );

      return await this.performRollback(lastSession, {
        confirm,
        dryRun,
        force,
      });
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to rollback last session: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Rollback a specific session
   */
  async rollbackSpecificSession(sessionId, options = {}) {
    const { confirm = false, dryRun = false, force = false } = options;

    console.log(chalk.cyan(`🔍 Finding session: ${sessionId}...`));

    try {
      const session = await this.rollbackManager.getSession(sessionId);

      if (!session) {
        console.log(chalk.red(`❌ Session not found: ${sessionId}`));
        return { success: false, reason: "session_not_found" };
      }

      if (session.status === "rolled_back") {
        console.log(
          chalk.yellow(`⚠️  Session ${sessionId} has already been rolled back`)
        );
        return { success: false, reason: "already_rolled_back" };
      }

      if (session.status === "expired") {
        console.log(
          chalk.yellow(
            `⚠️  Session ${sessionId} has expired and cannot be rolled back`
          )
        );
        return { success: false, reason: "expired" };
      }

      console.log(chalk.green(`✅ Found session: ${session.id}`));
      console.log(
        chalk.gray(
          `   Created: ${new Date(session.startTime).toLocaleString()}`
        )
      );
      console.log(chalk.gray(`   Operations: ${session.operations.length}`));

      return await this.performRollback(session, { confirm, dryRun, force });
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to rollback session: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Interactive rollback selection
   */
  async interactiveRollback(options = {}) {
    const { confirm = false, dryRun = false, force = false } = options;

    console.log(chalk.cyan("🔍 Finding available rollback sessions..."));

    try {
      const sessions = await this.rollbackManager.getActiveSessions();

      if (sessions.length === 0) {
        console.log(chalk.yellow("⚠️  No rollback sessions available"));
        return { success: false, reason: "no_sessions" };
      }

      if (sessions.length === 1) {
        console.log(
          chalk.cyan("💡 Only one session available, selecting automatically")
        );
        return await this.performRollback(sessions[0], {
          confirm,
          dryRun,
          force,
        });
      }

      // Multiple sessions - let user choose
      console.log(
        this.tableDisplay.createSectionHeader(
          "Available Sessions",
          `${sessions.length} sessions found`
        )
      );

      const sessionsTable = this.createSessionsTable(sessions);
      console.log(sessionsTable);

      const choices = sessions.map((session) => ({
        name: `${session.id} - ${new Date(
          session.startTime
        ).toLocaleString()} (${session.operations.length} operations)`,
        value: session.id,
      }));

      choices.push({ name: "Cancel", value: null });

      const answers = await inquirer.prompt([
        {
          type: "list",
          name: "sessionId",
          message: "Which session would you like to rollback?",
          choices,
        },
      ]);

      if (!answers.sessionId) {
        console.log(chalk.yellow("⏸️  Rollback cancelled"));
        return { success: false, reason: "user_cancelled" };
      }

      const selectedSession = sessions.find((s) => s.id === answers.sessionId);
      return await this.performRollback(selectedSession, {
        confirm,
        dryRun,
        force,
      });
    } catch (error) {
      console.error(
        chalk.red(`❌ Interactive rollback failed: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Perform the actual rollback operation
   */
  async performRollback(session, options = {}) {
    const { confirm = false, dryRun = false, force = false } = options;

    try {
      // Display rollback preview
      await this.displayRollbackPreview(session);

      // Handle confirmation (if not in dry-run mode)
      if (!dryRun && !force) {
        const shouldProceed = await this.handleRollbackConfirmation(
          session,
          confirm
        );

        if (!shouldProceed) {
          console.log(chalk.yellow("\n⏸️  Rollback cancelled by user"));
          return { success: false, reason: "user_cancelled" };
        }
      }

      if (dryRun) {
        console.log(chalk.cyan("\n🔍 Dry run complete - no changes made"));
        return { success: true, dryRun: true, session };
      }

      // Perform actual rollback
      console.log(chalk.cyan("\n🔄 Performing rollback..."));

      const rollbackResult = await this.executeRollback(session);

      if (rollbackResult.success) {
        console.log(chalk.green(`\n✅ Rollback completed successfully!`));
        console.log(
          chalk.gray(`   Session ${session.id} has been rolled back`)
        );
        console.log(
          chalk.gray(
            `   ${rollbackResult.operationsProcessed} operations processed`
          )
        );

        if (rollbackResult.playlistsDeleted !== undefined) {
          console.log(
            chalk.green(
              `   🗑️  ${rollbackResult.playlistsDeleted} playlist(s) deleted`
            )
          );
        }

        if (rollbackResult.failures > 0) {
          console.log(
            chalk.yellow(`   ⚠️  ${rollbackResult.failures} operations failed`)
          );
        }
      } else {
        console.log(chalk.red(`\n❌ Rollback partially failed`));
        console.log(
          chalk.gray(
            `   Session ${session.id} marked as rolled back with failures`
          )
        );
        console.log(
          chalk.gray(
            `   ${rollbackResult.operationsProcessed} operations processed`
          )
        );
        console.log(
          chalk.red(`   ${rollbackResult.failures} operations failed`)
        );

        if (rollbackResult.playlistsDeleted !== undefined) {
          console.log(
            chalk.green(
              `   🗑️  ${rollbackResult.playlistsDeleted}/${rollbackResult.totalPlaylists} playlist(s) deleted`
            )
          );
        }

        // Show details of failed operations
        if (
          rollbackResult.failedOperations &&
          rollbackResult.failedOperations.length > 0
        ) {
          console.log(chalk.red(`\n❌ Failed Operations:`));
          rollbackResult.failedOperations.forEach((failure, index) => {
            console.log(
              chalk.red(
                `   ${index + 1}. Playlist ${failure.playlistId}: ${
                  failure.error
                }`
              )
            );
          });
        }
      }

      return rollbackResult;
    } catch (error) {
      console.error(
        chalk.red(`❌ Rollback execution failed: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Display rollback preview
   */
  async displayRollbackPreview(session) {
    console.log(
      this.tableDisplay.createSectionHeader(
        "Rollback Preview",
        `Session ${session.id}`
      )
    );

    // Session information
    const sessionInfo = [
      { label: "Session ID", value: session.id },
      { label: "Created", value: new Date(session.startTime).toLocaleString() },
      { label: "Type", value: session.sessionType },
      { label: "User", value: session.spotifyUserId },
      { label: "Operations", value: session.operations.length.toString() },
      {
        label: "Playlists Created",
        value: session.playlistsCreated.toString(),
      },
      { label: "Tracks Affected", value: session.tracksAffected.toString() },
    ];

    const sessionTable = this.tableDisplay.createSummaryTable(sessionInfo);
    console.log(sessionTable);

    // Operations table
    if (session.operations.length > 0) {
      console.log(
        this.tableDisplay.createSectionHeader("Operations to Rollback")
      );
      const operationsTable = this.createOperationsTable(session.operations);
      console.log(operationsTable);
    }
  }

  /**
   * Handle rollback confirmation
   */
  async handleRollbackConfirmation(session, autoConfirm = false) {
    if (autoConfirm) {
      console.log(chalk.green("\n✅ Auto-confirmed with --confirm flag"));
      return true;
    }

    console.log(this.tableDisplay.createSectionHeader("Rollback Confirmation"));

    const answers = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: `Are you sure you want to rollback session ${session.id}? This will delete ${session.playlistsCreated} playlist(s) from Spotify.`,
        default: false,
      },
    ]);

    return answers.proceed;
  }

  /**
   * Execute the rollback operation
   */
  async executeRollback(session) {
    console.log(chalk.cyan("🔄 Executing rollback operations..."));

    try {
      // Initialize playlist deletion utility
      await this.playlistDeletion.initialize();
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to initialize Spotify API: ${error.message}`)
      );
      return {
        success: false,
        operationsProcessed: 0,
        failures: session.operations.length,
        session,
        error: "Failed to initialize Spotify API for deletion",
      };
    }

    let operationsProcessed = 0;
    let failures = 0;
    const failedOperations = [];

    // Group operations by type for efficient processing
    const playlistOperations = session.operations.filter(
      (op) => op.operationType === "create_playlist"
    );
    const otherOperations = session.operations.filter(
      (op) => op.operationType !== "create_playlist"
    );

    // Process playlist deletions
    if (playlistOperations.length > 0) {
      console.log(
        chalk.cyan(`🗑️  Deleting ${playlistOperations.length} playlist(s)...`)
      );

      const playlistsToDelete = playlistOperations.map((op) => {
        const data = JSON.parse(op.operationData);
        return {
          id: op.resourceId,
          name: data.name,
          operationId: op.id,
        };
      });

      const deletionResults = await this.playlistDeletion.deletePlaylists(
        playlistsToDelete,
        {
          maxRetries: 3,
          retryDelay: 2000,
          continueOnError: true,
          progressCallback: this.playlistDeletion.createProgressTracker(),
        }
      );

      // Update operation statuses based on results
      for (const result of deletionResults.results) {
        if (result.success) {
          operationsProcessed++;
          console.log(
            chalk.gray(
              `   ✅ Operation ${result.operationId || "unknown"} completed`
            )
          );
        } else {
          failures++;
          failedOperations.push({
            operationId: result.operationId,
            playlistId: result.playlistId,
            error: result.error,
            attempts: result.attempts,
          });

          // Mark operation as failed in database
          if (result.operationId) {
            await this.rollbackManager.markOperationFailed(
              result.operationId,
              new Error(result.error)
            );
          }

          console.error(
            chalk.red(
              `   ❌ Failed to delete playlist ${result.playlistName}: ${result.error}`
            )
          );
        }
      }
    }

    // Process other operations (track additions, etc.)
    // Note: For track additions, we don't need to do anything as deleting the playlist removes all tracks
    if (otherOperations.length > 0) {
      console.log(
        chalk.gray(
          `ℹ️  Skipping ${otherOperations.length} track operation(s) - handled by playlist deletion`
        )
      );
      operationsProcessed += otherOperations.length;
    }

    // Mark session as rolled back
    await this.rollbackManager.markSessionRolledBack(
      session.id,
      `Manual rollback via CLI - ${operationsProcessed} operations processed, ${failures} failed`
    );

    // Cleanup
    await this.playlistDeletion.cleanup();

    return {
      success: failures === 0,
      operationsProcessed,
      failures,
      session,
      failedOperations,
      playlistsDeleted: playlistOperations.length - failures,
      totalPlaylists: playlistOperations.length,
    };
  }

  /**
   * Create sessions table
   */
  createSessionsTable(sessions) {
    const tableData = sessions.map((session) => ({
      id: session.id.substring(0, 12) + "...",
      type: session.sessionType,
      started: new Date(session.startTime).toLocaleDateString(),
      operations: session.operations.length,
      playlists: session.playlistsCreated,
      tracks: session.tracksAffected,
      status: session.status,
    }));

    return this.tableDisplay.createDataTable(tableData, [
      { key: "id", label: "Session ID", width: 15 },
      { key: "type", label: "Type", width: 12 },
      { key: "started", label: "Started", width: 12 },
      { key: "operations", label: "Ops", width: 6 },
      { key: "playlists", label: "Playlists", width: 10 },
      { key: "tracks", label: "Tracks", width: 8 },
      { key: "status", label: "Status", width: 10 },
    ]);
  }

  /**
   * Create operations table
   */
  createOperationsTable(operations) {
    const tableData = operations.map((op) => {
      const data = JSON.parse(op.operationData);
      return {
        id: op.id,
        type: op.operationType,
        resource: op.resourceType,
        name: data.name || data.playlistId || op.resourceId.substring(0, 20),
        status: op.status,
        created: new Date(op.createdAt).toLocaleString(),
      };
    });

    return this.tableDisplay.createDataTable(tableData, [
      { key: "id", label: "ID", width: 6 },
      { key: "type", label: "Operation", width: 15 },
      { key: "resource", label: "Resource", width: 10 },
      { key: "name", label: "Name", width: 30 },
      { key: "status", label: "Status", width: 12 },
      { key: "created", label: "Created", width: 20 },
    ]);
  }

  /**
   * Create rollback summary table
   */
  createRollbackSummaryTable(stats) {
    const summaryData = [
      { label: "Total Sessions", value: stats.totalSessions },
      { label: "Active Sessions", value: stats.activeSessions },
      { label: "Rolled Back Sessions", value: stats.rolledBackSessions },
      { label: "Total Playlists Created", value: stats.totalPlaylistsCreated },
      { label: "Total Tracks Affected", value: stats.totalTracksAffected },
    ];

    return this.tableDisplay.createSummaryTable(summaryData);
  }
}

/**
 * Command handler functions for CLI
 */
async function rollbackCommand(options = {}) {
  const rollback = new RollbackCommand();
  return await rollback.execute(options);
}

async function listSessionsCommand(options = {}) {
  const rollback = new RollbackCommand();
  return await rollback.execute({ ...options, list: true });
}

module.exports = {
  RollbackCommand,
  rollbackCommand,
  listSessionsCommand,
};
