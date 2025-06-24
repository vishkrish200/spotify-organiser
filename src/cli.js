#!/usr/bin/env node

/**
 * Spotify Organizer CLI
 * Main command line interface for the Spotify liked songs auto-categorizer
 */

const { Command } = require("commander");
const chalk = require("chalk");
const authCommand = require("./commands/auth");
const { scanCommand, statusCommand } = require("./commands/scan");
const benchmarkCommand = require("./commands/benchmark");

const program = new Command();

// Package information
program
  .name("spotify-organizer")
  .description(
    "CLI tool for automatically organizing Spotify liked songs into categorized playlists"
  )
  .version("1.0.0");

// =====================================
// Authentication Commands
// =====================================

program
  .command("auth")
  .description("Authenticate with Spotify and store credentials securely")
  .action(async () => {
    try {
      await authCommand();
    } catch (error) {
      console.error(chalk.red("Authentication failed:"), error.message);
      process.exit(1);
    }
  });

// =====================================
// Data Ingest Commands
// =====================================

program
  .command("scan")
  .description("Fetch and cache all liked songs from your Spotify account")
  .option(
    "--extended-mode",
    "Fetch additional data: artist genres and audio features (tempo, energy, etc.)"
  )
  .action(async (options) => {
    try {
      await scanCommand(options);
    } catch (error) {
      console.error(chalk.red("Scan failed:"), error.message);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current status of cached data and recent scan history")
  .action(async () => {
    try {
      await statusCommand();
    } catch (error) {
      console.error(chalk.red("Status check failed:"), error.message);
      process.exit(1);
    }
  });

// =====================================
// Performance & Optimization Commands
// =====================================

program
  .command("benchmark")
  .description("Run performance tests and analyze optimization opportunities")
  .option("--export", "Export detailed results to JSON file")
  .option("--format <type>", "Output format: console, json", "console")
  .option(
    "--output <file>",
    "Output file name for exported results",
    "performance-results.json"
  )
  .action(async (options) => {
    try {
      await benchmarkCommand(options);
    } catch (error) {
      console.error(chalk.red("Benchmark failed:"), error.message);
      process.exit(1);
    }
  });

// =====================================
// Analysis Commands (Future)
// =====================================

program
  .command("analyze")
  .description(
    "Analyze cached tracks to discover grouping patterns and categories"
  )
  .option("--min-tracks <number>", "Minimum tracks required per playlist", "15")
  .action(() => {
    console.log(chalk.yellow("📋 Analysis command coming soon..."));
    console.log(
      chalk.gray(
        "This will discover genres, decades, and other categorization patterns"
      )
    );
  });

program
  .command("preview")
  .description(
    "Preview the playlists that would be created without making changes"
  )
  .action(() => {
    console.log(chalk.yellow("👀 Preview command coming soon..."));
    console.log(
      chalk.gray("This will show proposed playlists in a formatted table")
    );
  });

// =====================================
// Playlist Generation Commands (Future)
// =====================================

program
  .command("generate")
  .description("Create categorized playlists in your Spotify account")
  .option(
    "--confirm",
    "Skip confirmation prompts and proceed with playlist creation"
  )
  .option(
    "--dry-run",
    "Show what would be created without making actual changes"
  )
  .action(() => {
    console.log(chalk.yellow("🎵 Generate command coming soon..."));
    console.log(
      chalk.gray("This will create playlists based on discovered categories")
    );
  });

program
  .command("rollback")
  .description("Undo recent playlist creation and delete generated playlists")
  .option("--last", "Only rollback the most recent generation run")
  .action(() => {
    console.log(chalk.yellow("↩️  Rollback command coming soon..."));
    console.log(
      chalk.gray("This will help you undo playlist generation if needed")
    );
  });

// =====================================
// Global Error Handling
// =====================================

process.on("uncaughtException", (error) => {
  console.error(chalk.red("Unexpected error:"), error.message);
  if (process.env.NODE_ENV === "development") {
    console.error(error.stack);
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(chalk.red("Unhandled promise rejection:"), reason);
  process.exit(1);
});

// =====================================
// Help Enhancement
// =====================================

program.on("--help", () => {
  console.log();
  console.log(chalk.cyan("Examples:"));
  console.log(
    "  $ spotify-organizer auth                    # First-time setup"
  );
  console.log(
    "  $ spotify-organizer scan                    # Fetch basic track data"
  );
  console.log(
    "  $ spotify-organizer scan --extended-mode    # Fetch with audio features"
  );
  console.log(
    "  $ spotify-organizer status                  # Check current data"
  );
  console.log(
    "  $ spotify-organizer benchmark               # Run performance tests"
  );
  console.log(
    "  $ spotify-organizer benchmark --export      # Export performance data"
  );
  console.log(
    "  $ spotify-organizer analyze                 # Find categories"
  );
  console.log(
    "  $ spotify-organizer preview                 # Preview playlists"
  );
  console.log(
    "  $ spotify-organizer generate --confirm      # Create playlists"
  );
  console.log();
  console.log(
    chalk.gray("For more help: https://github.com/username/spotify-organizer")
  );
});

// Parse command line arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
