/**
 * Rollback Manager
 *
 * Handles rollback data storage, session management, and rollback operations
 * for the Spotify Organizer. Provides safety mechanisms for undoing playlist
 * creation and managing rollback data lifecycle.
 */

const chalk = require("chalk");
const DatabaseManager = require("./database");

class RollbackManager {
  constructor() {
    this.db = null;
    this.currentSession = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the rollback manager
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      this.db = new DatabaseManager();
      await this.db.initialize();
      this.isInitialized = true;

      // Clean up expired sessions on initialization
      await this.cleanupExpiredSessions();

      console.log(chalk.gray("🔄 RollbackManager initialized"));
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to initialize RollbackManager: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Create a new rollback session
   */
  async createSession(sessionType, spotifyUserId, expiryDays = 30) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const expiryTime = new Date();
      expiryTime.setDate(expiryTime.getDate() + expiryDays);

      const session = await this.db.prisma.rollbackSession.create({
        data: {
          sessionType,
          spotifyUserId,
          expiryTime,
        },
      });

      this.currentSession = session;
      console.log(chalk.gray(`🗂️  Created rollback session: ${session.id}`));

      return session;
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to create rollback session: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * End the current session
   */
  async endSession(sessionId = null) {
    const targetSessionId = sessionId || this.currentSession?.id;

    if (!targetSessionId) {
      console.warn(chalk.yellow("⚠️  No active session to end"));
      return;
    }

    try {
      await this.db.prisma.rollbackSession.update({
        where: { id: targetSessionId },
        data: {
          endTime: new Date(),
          status: "active", // Keep active for rollback capability
        },
      });

      if (this.currentSession?.id === targetSessionId) {
        this.currentSession = null;
      }

      console.log(chalk.gray(`✅ Ended rollback session: ${targetSessionId}`));
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to end rollback session: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Log a rollback operation
   */
  async logOperation(operationType, resourceType, resourceId, operationData) {
    if (!this.currentSession) {
      throw new Error(
        "No active rollback session. Call createSession() first."
      );
    }

    try {
      const operation = await this.db.prisma.rollbackOperation.create({
        data: {
          sessionId: this.currentSession.id,
          operationType,
          resourceType,
          resourceId,
          operationData: JSON.stringify(operationData),
          status: "completed",
        },
      });

      // Update session statistics
      await this.updateSessionStats(this.currentSession.id, operationType);

      console.log(
        chalk.gray(
          `📝 Logged rollback operation: ${operationType} for ${resourceType} ${resourceId}`
        )
      );

      return operation;
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to log rollback operation: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Update session statistics
   */
  async updateSessionStats(sessionId, operationType) {
    try {
      const updateData = {};

      if (operationType === "create_playlist") {
        updateData.playlistsCreated = { increment: 1 };
      } else if (operationType === "add_tracks") {
        updateData.tracksAffected = { increment: 1 };
      }

      if (Object.keys(updateData).length > 0) {
        await this.db.prisma.rollbackSession.update({
          where: { id: sessionId },
          data: updateData,
        });
      }
    } catch (error) {
      console.warn(
        chalk.yellow(`⚠️  Failed to update session stats: ${error.message}`)
      );
    }
  }

  /**
   * Get all active rollback sessions
   */
  async getActiveSessions(spotifyUserId = null) {
    try {
      const where = {
        status: "active",
        expiryTime: { gt: new Date() },
      };

      if (spotifyUserId) {
        where.spotifyUserId = spotifyUserId;
      }

      const sessions = await this.db.prisma.rollbackSession.findMany({
        where,
        include: {
          operations: true,
        },
        orderBy: { startTime: "desc" },
      });

      return sessions;
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to get active sessions: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Get the most recent session
   */
  async getLastSession(spotifyUserId = null) {
    try {
      const where = {
        status: "active",
        expiryTime: { gt: new Date() },
      };

      if (spotifyUserId) {
        where.spotifyUserId = spotifyUserId;
      }

      const session = await this.db.prisma.rollbackSession.findFirst({
        where,
        include: {
          operations: {
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { startTime: "desc" },
      });

      return session;
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to get last session: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Get session by ID with operations
   */
  async getSession(sessionId) {
    try {
      const session = await this.db.prisma.rollbackSession.findUnique({
        where: { id: sessionId },
        include: {
          operations: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      return session;
    } catch (error) {
      console.error(chalk.red(`❌ Failed to get session: ${error.message}`));
      throw error;
    }
  }

  /**
   * Mark a session as rolled back
   */
  async markSessionRolledBack(sessionId, reason = null) {
    try {
      await this.db.prisma.rollbackSession.update({
        where: { id: sessionId },
        data: {
          status: "rolled_back",
          rolledBackAt: new Date(),
          rollbackReason: reason,
        },
      });

      // Mark all operations as rolled back
      await this.db.prisma.rollbackOperation.updateMany({
        where: { sessionId },
        data: {
          status: "rolled_back",
          rolledBackAt: new Date(),
        },
      });

      console.log(chalk.green(`✅ Marked session ${sessionId} as rolled back`));
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to mark session as rolled back: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Mark an operation as failed during rollback
   */
  async markOperationFailed(operationId, error) {
    try {
      await this.db.prisma.rollbackOperation.update({
        where: { id: operationId },
        data: {
          status: "failed",
          rollbackError: error.message,
          rollbackAttempts: { increment: 1 },
        },
      });

      console.warn(
        chalk.yellow(
          `⚠️  Marked operation ${operationId} as failed: ${error.message}`
        )
      );
    } catch (updateError) {
      console.error(
        chalk.red(
          `❌ Failed to mark operation as failed: ${updateError.message}`
        )
      );
    }
  }

  /**
   * Clean up expired sessions with configurable policies
   */
  async cleanupExpiredSessions(options = {}) {
    const {
      markExpiredOnly = false,
      deleteAfterDays = 7, // Delete expired sessions after 7 additional days
      batchSize = 100,
      dryRun = false,
    } = options;

    try {
      const now = new Date();
      let totalProcessed = 0;

      // Step 1: Mark active sessions as expired if past expiry time
      const expiredResult = await this.markExpiredSessions(
        now,
        batchSize,
        dryRun
      );
      totalProcessed += expiredResult.marked;

      // Step 2: Optionally delete old expired sessions
      let deletedResult = { deleted: 0 };
      if (!markExpiredOnly) {
        const deleteThreshold = new Date(
          now.getTime() - deleteAfterDays * 24 * 60 * 60 * 1000
        );
        deletedResult = await this.deleteOldExpiredSessions(
          deleteThreshold,
          batchSize,
          dryRun
        );
        totalProcessed += deletedResult.deleted;
      }

      // Step 3: Cleanup orphaned operations
      const orphanResult = await this.cleanupOrphanedOperations(
        batchSize,
        dryRun
      );
      totalProcessed += orphanResult.cleaned;

      if (totalProcessed > 0) {
        console.log(
          chalk.gray(
            `🧹 Processed ${totalProcessed} items in expiration cleanup`
          )
        );
      }

      return {
        totalProcessed,
        sessionsMarkedExpired: expiredResult.marked,
        sessionsDeleted: deletedResult.deleted,
        operationsCleaned: orphanResult.cleaned,
      };
    } catch (error) {
      console.warn(
        chalk.yellow(`⚠️  Failed to cleanup expired sessions: ${error.message}`)
      );
      return {
        totalProcessed: 0,
        sessionsMarkedExpired: 0,
        sessionsDeleted: 0,
        operationsCleaned: 0,
        error: error.message,
      };
    }
  }

  /**
   * Mark active sessions as expired
   */
  async markExpiredSessions(now, batchSize = 100, dryRun = false) {
    try {
      if (dryRun) {
        // Count expired sessions without updating
        const count = await this.db.prisma.rollbackSession.count({
          where: {
            status: "active",
            expiryTime: { lt: now },
          },
        });

        console.log(
          chalk.gray(`🔍 [DRY RUN] Would mark ${count} sessions as expired`)
        );
        return { marked: count };
      }

      const result = await this.db.prisma.rollbackSession.updateMany({
        where: {
          status: "active",
          expiryTime: { lt: now },
        },
        data: {
          status: "expired",
        },
      });

      if (result.count > 0) {
        console.log(
          chalk.gray(`⏰ Marked ${result.count} sessions as expired`)
        );
      }

      return { marked: result.count };
    } catch (error) {
      console.warn(
        chalk.yellow(`⚠️  Failed to mark expired sessions: ${error.message}`)
      );
      return { marked: 0, error: error.message };
    }
  }

  /**
   * Delete old expired sessions and their operations
   */
  async deleteOldExpiredSessions(
    deleteThreshold,
    batchSize = 100,
    dryRun = false
  ) {
    try {
      // Find expired sessions older than threshold
      const oldExpiredSessions = await this.db.prisma.rollbackSession.findMany({
        where: {
          status: "expired",
          expiryTime: { lt: deleteThreshold },
        },
        select: { id: true },
        take: batchSize,
      });

      if (oldExpiredSessions.length === 0) {
        return { deleted: 0 };
      }

      const sessionIds = oldExpiredSessions.map((s) => s.id);

      if (dryRun) {
        console.log(
          chalk.gray(
            `🔍 [DRY RUN] Would delete ${sessionIds.length} old expired sessions`
          )
        );
        return { deleted: sessionIds.length };
      }

      // Delete operations first (foreign key constraint)
      const operationsDeleted =
        await this.db.prisma.rollbackOperation.deleteMany({
          where: {
            sessionId: { in: sessionIds },
          },
        });

      // Delete sessions
      const sessionsDeleted = await this.db.prisma.rollbackSession.deleteMany({
        where: {
          id: { in: sessionIds },
        },
      });

      console.log(
        chalk.gray(
          `🗑️  Deleted ${sessionsDeleted.count} old sessions and ${operationsDeleted.count} operations`
        )
      );

      return {
        deleted: sessionsDeleted.count,
        operationsDeleted: operationsDeleted.count,
      };
    } catch (error) {
      console.warn(
        chalk.yellow(
          `⚠️  Failed to delete old expired sessions: ${error.message}`
        )
      );
      return { deleted: 0, error: error.message };
    }
  }

  /**
   * Clean up orphaned operations (operations without valid sessions)
   */
  async cleanupOrphanedOperations(batchSize = 100, dryRun = false) {
    try {
      // Get all operation session IDs and all valid session IDs
      const allOperations = await this.db.prisma.rollbackOperation.findMany({
        select: { id: true, sessionId: true },
        take: batchSize,
      });

      if (allOperations.length === 0) {
        return { cleaned: 0 };
      }

      const allSessions = await this.db.prisma.rollbackSession.findMany({
        select: { id: true },
      });

      const validSessionIds = new Set(allSessions.map((s) => s.id));
      const orphanedOperationIds = allOperations
        .filter((op) => !validSessionIds.has(op.sessionId))
        .map((op) => op.id);

      if (orphanedOperationIds.length === 0) {
        return { cleaned: 0 };
      }

      if (dryRun) {
        console.log(
          chalk.gray(
            `🔍 [DRY RUN] Would clean ${orphanedOperationIds.length} orphaned operations`
          )
        );
        return { cleaned: orphanedOperationIds.length };
      }

      const result = await this.db.prisma.rollbackOperation.deleteMany({
        where: {
          id: { in: orphanedOperationIds },
        },
      });

      if (result.count > 0) {
        console.log(
          chalk.gray(`🧹 Cleaned ${result.count} orphaned operations`)
        );
      }

      return { cleaned: result.count };
    } catch (error) {
      console.warn(
        chalk.yellow(
          `⚠️  Failed to cleanup orphaned operations: ${error.message}`
        )
      );
      return { cleaned: 0, error: error.message };
    }
  }

  /**
   * Set custom expiration policies for sessions
   */
  async setExpirationPolicy(policy = {}) {
    const defaultPolicy = {
      activeSessionDays: 30, // Sessions expire after 30 days
      deleteExpiredAfterDays: 7, // Delete expired sessions after 7 additional days
      maxSessionsPerUser: 50, // Limit per user
      cleanupIntervalHours: 24, // Run cleanup every 24 hours
      batchSize: 100, // Process in batches
    };

    this.expirationPolicy = { ...defaultPolicy, ...policy };

    console.log(chalk.gray("📋 Updated expiration policy:"));
    console.log(
      chalk.gray(
        `   Active session lifetime: ${this.expirationPolicy.activeSessionDays} days`
      )
    );
    console.log(
      chalk.gray(
        `   Delete expired after: ${this.expirationPolicy.deleteExpiredAfterDays} days`
      )
    );
    console.log(
      chalk.gray(
        `   Max sessions per user: ${this.expirationPolicy.maxSessionsPerUser}`
      )
    );

    return this.expirationPolicy;
  }

  /**
   * Get current expiration policy
   */
  getExpirationPolicy() {
    return (
      this.expirationPolicy || {
        activeSessionDays: 30,
        deleteExpiredAfterDays: 7,
        maxSessionsPerUser: 50,
        cleanupIntervalHours: 24,
        batchSize: 100,
      }
    );
  }

  /**
   * Enforce user session limits
   */
  async enforceUserSessionLimits(spotifyUserId, limit = null) {
    const sessionLimit = limit || this.getExpirationPolicy().maxSessionsPerUser;

    try {
      // Get all active sessions for user, ordered by creation time (oldest first)
      const userSessions = await this.db.prisma.rollbackSession.findMany({
        where: {
          spotifyUserId,
          status: "active",
        },
        orderBy: { startTime: "asc" },
        select: { id: true, startTime: true },
      });

      if (userSessions.length <= sessionLimit) {
        return { enforced: false, sessionsExpired: 0 };
      }

      // Expire oldest sessions beyond the limit
      const excessSessions = userSessions.slice(
        0,
        userSessions.length - sessionLimit
      );
      const sessionIds = excessSessions.map((s) => s.id);

      const result = await this.db.prisma.rollbackSession.updateMany({
        where: {
          id: { in: sessionIds },
        },
        data: {
          status: "expired",
          rollbackReason: `Exceeded user session limit of ${sessionLimit}`,
        },
      });

      console.log(
        chalk.yellow(
          `⚖️  Expired ${result.count} sessions for user ${spotifyUserId} (limit: ${sessionLimit})`
        )
      );

      return { enforced: true, sessionsExpired: result.count };
    } catch (error) {
      console.warn(
        chalk.yellow(`⚠️  Failed to enforce session limits: ${error.message}`)
      );
      return { enforced: false, sessionsExpired: 0, error: error.message };
    }
  }

  /**
   * Get data expiration statistics
   */
  async getExpirationStats() {
    try {
      const now = new Date();
      const policy = this.getExpirationPolicy();
      const deleteThreshold = new Date(
        now.getTime() - policy.deleteExpiredAfterDays * 24 * 60 * 60 * 1000
      );

      // Active sessions approaching expiry
      const approachingExpiry = await this.db.prisma.rollbackSession.count({
        where: {
          status: "active",
          expiryTime: {
            gt: now,
            lt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // Next 7 days
          },
        },
      });

      // Expired sessions ready for deletion
      const readyForDeletion = await this.db.prisma.rollbackSession.count({
        where: {
          status: "expired",
          expiryTime: { lt: deleteThreshold },
        },
      });

      // Orphaned operations - count operations with invalid session references
      const allOperationSessionIds =
        await this.db.prisma.rollbackOperation.findMany({
          select: { sessionId: true },
          distinct: ["sessionId"],
        });

      const validSessionIds = await this.db.prisma.rollbackSession.findMany({
        select: { id: true },
      });

      const validSessionIdSet = new Set(validSessionIds.map((s) => s.id));
      const orphanedSessionIds = allOperationSessionIds
        .filter((op) => !validSessionIdSet.has(op.sessionId))
        .map((op) => op.sessionId);

      const orphanedOps =
        orphanedSessionIds.length > 0
          ? await this.db.prisma.rollbackOperation.count({
              where: {
                sessionId: { in: orphanedSessionIds },
              },
            })
          : 0;

      // Storage usage approximation
      const totalOperations = await this.db.prisma.rollbackOperation.count();
      const totalSessions = await this.db.prisma.rollbackSession.count();

      // Rough estimate: session ~1KB, operation ~2KB
      const storageEstimateKB = totalSessions * 1 + totalOperations * 2;

      return {
        currentPolicy: policy,
        sessionsApproachingExpiry: approachingExpiry,
        expiredSessionsReadyForDeletion: readyForDeletion,
        orphanedOperations: orphanedOps,
        totalSessions,
        totalOperations,
        estimatedStorageKB: storageEstimateKB,
        estimatedStorageMB: Math.round((storageEstimateKB / 1024) * 100) / 100,
      };
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to get expiration stats: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Perform comprehensive data maintenance
   */
  async performDataMaintenance(options = {}) {
    const {
      enforceUserLimits = true,
      cleanupExpired = true,
      deleteOldExpired = true,
      cleanupOrphaned = true,
      dryRun = false,
    } = options;

    console.log(
      chalk.cyan(`🔧 Starting data maintenance${dryRun ? " (DRY RUN)" : ""}...`)
    );

    const results = {
      timestamp: new Date(),
      dryRun,
      userLimitsEnforced: 0,
      sessionsMarkedExpired: 0,
      sessionsDeleted: 0,
      operationsCleaned: 0,
      errors: [],
    };

    try {
      // Step 1: Enforce user session limits
      if (enforceUserLimits) {
        try {
          const userIds = await this.db.prisma.rollbackSession.findMany({
            select: { spotifyUserId: true },
            distinct: ["spotifyUserId"],
          });

          for (const { spotifyUserId } of userIds) {
            const limitResult = await this.enforceUserSessionLimits(
              spotifyUserId
            );
            if (limitResult.enforced) {
              results.userLimitsEnforced += limitResult.sessionsExpired;
            }
          }
        } catch (error) {
          results.errors.push(`User limits enforcement: ${error.message}`);
        }
      }

      // Step 2: Standard expiration cleanup
      if (cleanupExpired || deleteOldExpired || cleanupOrphaned) {
        try {
          const cleanupResult = await this.cleanupExpiredSessions({
            markExpiredOnly: !deleteOldExpired,
            deleteAfterDays: this.getExpirationPolicy().deleteExpiredAfterDays,
            batchSize: this.getExpirationPolicy().batchSize,
            dryRun,
          });

          results.sessionsMarkedExpired = cleanupResult.sessionsMarkedExpired;
          results.sessionsDeleted = cleanupResult.sessionsDeleted;
          results.operationsCleaned = cleanupResult.operationsCleaned;
        } catch (error) {
          results.errors.push(`Expiration cleanup: ${error.message}`);
        }
      }

      console.log(chalk.green("✅ Data maintenance completed"));
      console.log(
        chalk.gray(
          `   Sessions marked expired: ${results.sessionsMarkedExpired}`
        )
      );
      console.log(
        chalk.gray(`   Sessions deleted: ${results.sessionsDeleted}`)
      );
      console.log(
        chalk.gray(`   Operations cleaned: ${results.operationsCleaned}`)
      );
      console.log(
        chalk.gray(`   User limits enforced: ${results.userLimitsEnforced}`)
      );

      if (results.errors.length > 0) {
        console.log(
          chalk.yellow(`   Errors encountered: ${results.errors.length}`)
        );
        results.errors.forEach((error, index) => {
          console.log(chalk.yellow(`     ${index + 1}. ${error}`));
        });
      }

      return results;
    } catch (error) {
      console.error(chalk.red(`❌ Data maintenance failed: ${error.message}`));
      results.errors.push(`Critical error: ${error.message}`);
      return results;
    }
  }

  /**
   * Get rollback statistics with expiration info
   */
  async getStats(spotifyUserId = null) {
    try {
      const where = spotifyUserId ? { spotifyUserId } : {};

      const stats = await this.db.prisma.rollbackSession.aggregate({
        where,
        _count: true,
        _sum: {
          playlistsCreated: true,
          tracksAffected: true,
        },
      });

      const activeCount = await this.db.prisma.rollbackSession.count({
        where: {
          ...where,
          status: "active",
          expiryTime: { gt: new Date() },
        },
      });

      const rolledBackCount = await this.db.prisma.rollbackSession.count({
        where: {
          ...where,
          status: "rolled_back",
        },
      });

      const expiredCount = await this.db.prisma.rollbackSession.count({
        where: {
          ...where,
          status: "expired",
        },
      });

      return {
        totalSessions: stats._count || 0,
        activeSessions: activeCount,
        rolledBackSessions: rolledBackCount,
        expiredSessions: expiredCount,
        totalPlaylistsCreated: stats._sum.playlistsCreated || 0,
        totalTracksAffected: stats._sum.tracksAffected || 0,
        expirationPolicy: this.getExpirationPolicy(),
      };
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to get rollback stats: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * Cleanup and disconnect
   */
  async cleanup() {
    try {
      if (this.currentSession) {
        await this.endSession();
      }

      if (this.db) {
        await this.db.disconnect();
      }

      this.isInitialized = false;
      console.log(chalk.gray("🔄 RollbackManager cleaned up"));
    } catch (error) {
      console.error(
        chalk.red(`❌ Error cleaning up RollbackManager: ${error.message}`)
      );
    }
  }
}

module.exports = RollbackManager;
