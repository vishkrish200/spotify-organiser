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
const analyzeCommand = require("./commands/analyze");
const { previewCommand } = require("./commands/preview");
const { rollbackCommand, listSessionsCommand } = require("./commands/rollback");
const MaintenanceCommand = require("./commands/maintenance");
const generateCommand = require("./commands/generate");

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
  .option("--details", "Show detailed breakdown of each category")
  .option("--export", "Export analysis results to JSON file")
  .action(async (options) => {
    try {
      await analyzeCommand({
        minTracks: parseInt(options.minTracks),
        showDetails: options.details,
        exportResults: options.export,
      });
    } catch (error) {
      console.error(chalk.red(`❌ Analysis failed: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command("preview")
  .description(
    "Preview the playlists that would be created without making changes"
  )
  .option(
    "--confirm",
    "Skip confirmation prompts and proceed with preview approval"
  )
  .option(
    "--dry-run",
    "Show what would be created without any confirmation prompts"
  )
  .option("--min-tracks <number>", "Minimum tracks required per playlist", "15")
  .option(
    "--max-playlists <number>",
    "Maximum number of playlists to preview",
    "25"
  )
  .option("--details", "Show detailed information including sample tracks")
  .option("--format <type>", "Output format: table, json", "table")
  .option("--output <file>", "Export preview results to file")
  .action(async (options) => {
    try {
      await previewCommand({
        confirm: options.confirm,
        dryRun: options.dryRun,
        minTracks: parseInt(options.minTracks),
        maxPlaylists: parseInt(options.maxPlaylists),
        details: options.details,
        format: options.format,
        output: options.output,
      });
    } catch (error) {
      console.error(chalk.red(`❌ Preview failed: ${error.message}`));
      process.exit(1);
    }
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
  .option(
    "--max-playlists <number>",
    "Maximum number of playlists to create",
    "25"
  )
  .action(async (options) => {
    try {
      await generateCommand({
        confirm: options.confirm,
        dryRun: options.dryRun,
        maxPlaylists: parseInt(options.maxPlaylists),
      });
    } catch (error) {
      console.error(chalk.red(`❌ Generate failed: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command("rollback")
  .description("Rollback recent playlist creation operations")
  .option("--last", "Rollback the most recent session")
  .option("--session <id>", "Rollback a specific session by ID")
  .option("--list", "List available rollback sessions")
  .option("--confirm", "Skip confirmation prompts and proceed with rollback")
  .option("--dry-run", "Show what would be rolled back without making changes")
  .option("--force", "Force rollback without confirmation (use with caution)")
  .action(async (options) => {
    try {
      await rollbackCommand(options);
    } catch (error) {
      console.error(chalk.red(`Command failed: ${error.message}`));
      process.exit(1);
    }
  });

// List rollback sessions command
program
  .command("rollback-list")
  .alias("rl")
  .description("List available rollback sessions")
  .action(async () => {
    try {
      await listSessionsCommand();
    } catch (error) {
      console.error(chalk.red(`Command failed: ${error.message}`));
      process.exit(1);
    }
  });

// =====================================
// Maintenance Commands
// =====================================

// Configure maintenance commands using the new MaintenanceCommand class
const maintenanceCommand = new MaintenanceCommand();
maintenanceCommand.configureCommand(program);

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
  console.log(
    "  $ spotify-organizer rollback --list         # List rollback sessions"
  );
  console.log(
    "  $ spotify-organizer rollback --last         # Rollback last session"
  );
  console.log(
    "  $ spotify-organizer maintenance status      # View scheduler status"
  );
  console.log(
    "  $ spotify-organizer maintenance start       # Start automated cleanup"
  );
  console.log(
    "  $ spotify-organizer maintenance run         # Run maintenance now"
  );
  console.log(
    "  $ spotify-organizer maintenance stats       # View maintenance stats"
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
