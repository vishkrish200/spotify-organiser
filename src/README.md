# Source Code Structure

This directory contains the main source code for the Spotify Organizer CLI tool.

## Directory Layout

```
src/
├── cli.js          # Main CLI entry point (executable)
├── index.js        # Library entry point for programmatic use
├── commands/       # CLI command implementations
├── lib/           # Core library modules
│   ├── auth.js      # Authentication & token management
│   ├── ingest.js    # Data fetching & caching
│   ├── discovery.js # Label discovery algorithm
│   └── playlist.js  # Playlist generation
└── utils/         # Shared utilities
    ├── config.js    # Configuration management
    ├── database.js  # SQLite database operations
    ├── logger.js    # Logging utilities
    └── spotify.js   # Spotify API client wrapper
```

## Command Structure

The CLI follows this pattern:

- `spotify-organizer <command> [options]`
- Each command is implemented in the `commands/` directory
- Core functionality is in the `lib/` directory
- Shared utilities are in the `utils/` directory

## Implementation Progress

- [x] Basic CLI structure with all commands defined
- [ ] Authentication module (Task 2)
- [ ] Data ingest module (Task 3)
- [ ] Label discovery algorithm (Task 4)
- [ ] Playlist generation (Task 5)
- [ ] Preview & confirmation (Task 6)
- [ ] Rollback functionality (Task 7)
- [ ] Status command (Task 8)
