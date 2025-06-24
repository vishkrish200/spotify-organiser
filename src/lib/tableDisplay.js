/**
 * Table Display Utility
 *
 * Provides formatted table displays for various data types using cli-table3
 * Supports playlists, analysis results, and general data visualization
 */

const Table = require("cli-table3");
const chalk = require("chalk");

class TableDisplay {
  constructor(options = {}) {
    this.defaultOptions = {
      style: {
        head: ["cyan"],
        border: ["gray"],
        compact: false,
      },
      wordWrap: true,
      wrapOnWordBoundary: false,
      ...options,
    };
  }

  /**
   * Create a playlist preview table
   */
  createPlaylistPreview(playlists, options = {}) {
    const { showSamples = true, maxSamples = 3, showStats = true } = options;

    const table = new Table({
      head: [
        chalk.cyan("Playlist Name"),
        chalk.cyan("Tracks"),
        chalk.cyan("Categories"),
        ...(showSamples ? [chalk.cyan("Sample Tracks")] : []),
        ...(showStats ? [chalk.cyan("Avg Duration")] : []),
      ],
      ...this.defaultOptions,
      colWidths: showSamples ? [25, 8, 15, 35, 12] : [30, 10, 20, 15],
    });

    playlists.forEach((playlist) => {
      const row = [
        this.formatPlaylistName(playlist.name, playlist.status),
        this.formatTrackCount(playlist.trackCount),
        this.formatCategories(playlist.categories),
      ];

      if (showSamples) {
        row.push(this.formatSampleTracks(playlist.tracks, maxSamples));
      }

      if (showStats) {
        row.push(this.formatDuration(playlist.avgDuration));
      }

      table.push(row);
    });

    return table.toString();
  }

  /**
   * Create an analysis results table
   */
  createAnalysisResults(analysisData, options = {}) {
    const { sortBy = "trackCount", ascending = false, maxRows = 10 } = options;

    const table = new Table({
      head: [
        chalk.cyan("Category"),
        chalk.cyan("Type"),
        chalk.cyan("Tracks"),
        chalk.cyan("Percentage"),
        chalk.cyan("Sample Artists/Info"),
      ],
      ...this.defaultOptions,
      colWidths: [20, 12, 8, 10, 30],
    });

    // Combine all analysis results
    const allResults = [];

    if (analysisData.genres) {
      analysisData.genres.forEach((genre) => {
        allResults.push({
          category: genre.label,
          type: "Genre",
          trackCount: genre.trackCount,
          percentage: (genre.trackCount / analysisData.totalTracks) * 100,
          info: genre.genre,
        });
      });
    }

    if (analysisData.decades) {
      analysisData.decades.forEach((decade) => {
        allResults.push({
          category: decade.label,
          type: "Decade",
          trackCount: decade.trackCount,
          percentage: (decade.trackCount / analysisData.totalTracks) * 100,
          info: decade.decade,
        });
      });
    }

    if (analysisData.bpmBands) {
      analysisData.bpmBands.forEach((bpm) => {
        allResults.push({
          category: bpm.label,
          type: "BPM",
          trackCount: bpm.trackCount,
          percentage: (bpm.trackCount / analysisData.totalTracks) * 100,
          info: bpm.bpmRange,
        });
      });
    }

    if (analysisData.energyQuartiles) {
      analysisData.energyQuartiles.forEach((energy) => {
        allResults.push({
          category: energy.label,
          type: "Energy",
          trackCount: energy.trackCount,
          percentage: (energy.trackCount / analysisData.totalTracks) * 100,
          info: energy.energyRange,
        });
      });
    }

    // Sort results
    allResults.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];

      if (ascending) {
        return aVal > bVal ? 1 : -1;
      }
      return aVal < bVal ? 1 : -1;
    });

    // Add rows to table (limited by maxRows)
    allResults.slice(0, maxRows).forEach((result) => {
      table.push([
        this.formatCategoryName(result.category, result.type),
        this.formatCategoryType(result.type),
        this.formatTrackCount(result.trackCount),
        this.formatPercentage(result.percentage),
        this.formatCategoryInfo(result.info, result.type),
      ]);
    });

    return table.toString();
  }

  /**
   * Create a general data table
   */
  createDataTable(data, columns, options = {}) {
    const { title = null, sortColumn = null, ascending = false } = options;

    const headers = columns.map((col) => chalk.cyan(col.title || col.key));

    const table = new Table({
      head: headers,
      ...this.defaultOptions,
      colWidths: columns.map((col) => col.width || null),
    });

    // Sort data if specified
    let sortedData = [...data];
    if (sortColumn) {
      sortedData.sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];

        if (ascending) {
          return aVal > bVal ? 1 : -1;
        }
        return aVal < bVal ? 1 : -1;
      });
    }

    // Add rows
    sortedData.forEach((row) => {
      const tableRow = columns.map((col) => {
        const value = row[col.key];

        if (col.formatter) {
          return col.formatter(value, row);
        }

        return this.formatValue(value, col.type);
      });

      table.push(tableRow);
    });

    let output = "";
    if (title) {
      output +=
        chalk.bold.white(`\n${title}\n`) + "=".repeat(title.length) + "\n\n";
    }
    output += table.toString();

    return output;
  }

  /**
   * Create a summary statistics table
   */
  createSummaryTable(stats, options = {}) {
    const { showPercentages = true } = options;

    const table = new Table({
      head: [chalk.cyan("Metric"), chalk.cyan("Value"), chalk.cyan("Details")],
      ...this.defaultOptions,
      colWidths: [20, 15, 35],
    });

    // Handle both array format and object format
    if (Array.isArray(stats)) {
      // New format: array of objects with { label, value, details }
      stats.forEach((item) => {
        table.push([
          this.formatMetricName(item.label),
          this.formatMetricValue(item.value),
          item.details ? chalk.gray(item.details) : chalk.gray("-"),
        ]);
      });
    } else {
      // Original format: flat object with key-value pairs
      Object.entries(stats).forEach(([key, value]) => {
        table.push([
          this.formatMetricName(key),
          this.formatMetricValue(value),
          this.formatMetricDetails(value, key),
        ]);
      });
    }

    return table.toString();
  }

  /**
   * Create a confirmation dialog table
   */
  createConfirmationDialog(action, items, options = {}) {
    const { showDetails = true, maxItems = 5 } = options;

    const table = new Table({
      head: [
        chalk.yellow("Action"),
        chalk.yellow("Item"),
        ...(showDetails ? [chalk.yellow("Details")] : []),
      ],
      ...this.defaultOptions,
      colWidths: showDetails ? [15, 25, 30] : [15, 40],
    });

    const displayItems = items.slice(0, maxItems);
    const remainingCount = items.length - maxItems;

    displayItems.forEach((item, index) => {
      const row = [
        index === 0 ? this.formatAction(action) : "",
        this.formatItemName(item),
      ];

      if (showDetails) {
        row.push(this.formatItemDetails(item));
      }

      table.push(row);
    });

    if (remainingCount > 0) {
      table.push([
        "",
        chalk.gray(`... and ${remainingCount} more`),
        ...(showDetails ? [chalk.gray("(see full list with --verbose)")] : []),
      ]);
    }

    return table.toString();
  }

  /**
   * Format playlist name with status indicators
   */
  formatPlaylistName(name, status = "new") {
    const truncated = this.truncateText(name, 22);

    switch (status) {
      case "existing":
        return chalk.yellow("📝 ") + truncated;
      case "update":
        return chalk.blue("🔄 ") + truncated;
      case "new":
      default:
        return chalk.green("✨ ") + truncated;
    }
  }

  /**
   * Format track count with color coding
   */
  formatTrackCount(count) {
    if (count === 0) return chalk.gray("0");
    if (count < 10) return chalk.yellow(count.toString());
    if (count < 50) return chalk.green(count.toString());
    return chalk.cyan(count.toString());
  }

  /**
   * Format categories display
   */
  formatCategories(categories) {
    if (!categories || categories.length === 0) {
      return chalk.gray("None");
    }

    if (categories.length === 1) {
      return categories[0];
    }

    return (
      categories.slice(0, 2).join(", ") +
      (categories.length > 2 ? chalk.gray(` +${categories.length - 2}`) : "")
    );
  }

  /**
   * Format sample tracks
   */
  formatSampleTracks(tracks, maxSamples = 3) {
    if (!tracks || tracks.length === 0) {
      return chalk.gray("No tracks");
    }

    const samples = tracks.slice(0, maxSamples);
    const sampleText = samples
      .map(
        (track) =>
          `• ${this.truncateText(track.name, 15)} - ${this.truncateText(
            track.artist,
            12
          )}`
      )
      .join("\n");

    if (tracks.length > maxSamples) {
      return (
        sampleText + chalk.gray(`\n... ${tracks.length - maxSamples} more`)
      );
    }

    return sampleText;
  }

  /**
   * Format duration
   */
  formatDuration(durationMs) {
    if (!durationMs) return chalk.gray("N/A");

    const minutes = Math.round(durationMs / 60000);
    const seconds = Math.round((durationMs % 60000) / 1000);

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  /**
   * Format category name with type-specific styling
   */
  formatCategoryName(name, type) {
    const truncated = this.truncateText(name, 18);

    switch (type.toLowerCase()) {
      case "genre":
        return chalk.magenta("🎵 ") + truncated;
      case "decade":
        return chalk.blue("📅 ") + truncated;
      case "bpm":
        return chalk.red("⚡ ") + truncated;
      case "energy":
        return chalk.yellow("🔥 ") + truncated;
      default:
        return truncated;
    }
  }

  /**
   * Format category type
   */
  formatCategoryType(type) {
    const colors = {
      Genre: chalk.magenta,
      Decade: chalk.blue,
      BPM: chalk.red,
      Energy: chalk.yellow,
    };

    return (colors[type] || chalk.white)(type);
  }

  /**
   * Format percentage
   */
  formatPercentage(percentage) {
    const percent = percentage.toFixed(1);

    if (percentage < 1) return chalk.gray(`${percent}%`);
    if (percentage < 5) return chalk.yellow(`${percent}%`);
    if (percentage < 15) return chalk.green(`${percent}%`);
    return chalk.cyan(`${percent}%`);
  }

  /**
   * Format category info
   */
  formatCategoryInfo(info, type) {
    return this.truncateText(info, 28);
  }

  /**
   * Format metric name
   */
  formatMetricName(name) {
    // If it's already formatted (contains spaces), use as-is
    if (name.includes(" ")) {
      return chalk.white(name);
    }

    // Convert camelCase to Title Case
    const formatted = name
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase());

    return chalk.white(formatted);
  }

  /**
   * Format metric value
   */
  formatMetricValue(value) {
    if (typeof value === "number") {
      if (value > 1000000) {
        return chalk.cyan(`${(value / 1000000).toFixed(1)}M`);
      }
      if (value > 1000) {
        return chalk.green(`${(value / 1000).toFixed(1)}K`);
      }
      return chalk.white(value.toString());
    }

    if (typeof value === "boolean") {
      return value ? chalk.green("✓") : chalk.red("✗");
    }

    return chalk.white(value.toString());
  }

  /**
   * Format metric details
   */
  formatMetricDetails(value, key) {
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        return chalk.gray(`${value.length} items`);
      }

      if (value.count !== undefined) {
        return chalk.gray(`Count: ${value.count}`);
      }
    }

    return chalk.gray("-");
  }

  /**
   * Format action for confirmation
   */
  formatAction(action) {
    const colors = {
      create: chalk.green,
      update: chalk.yellow,
      delete: chalk.red,
      sync: chalk.blue,
    };

    const actionLower = action.toLowerCase();
    const color = colors[actionLower] || chalk.white;

    return color(action.toUpperCase());
  }

  /**
   * Format item name
   */
  formatItemName(item) {
    if (typeof item === "string") {
      return this.truncateText(item, 23);
    }

    if (item.name) {
      return this.truncateText(item.name, 23);
    }

    return this.truncateText(item.toString(), 23);
  }

  /**
   * Format item details
   */
  formatItemDetails(item) {
    if (typeof item === "string") {
      return chalk.gray("Playlist");
    }

    if (item.trackCount !== undefined) {
      return chalk.gray(`${item.trackCount} tracks`);
    }

    if (item.type) {
      return chalk.gray(item.type);
    }

    return chalk.gray("Item");
  }

  /**
   * Format a generic value based on type
   */
  formatValue(value, type = "string") {
    if (value === null || value === undefined) {
      return chalk.gray("N/A");
    }

    switch (type) {
      case "number":
        return chalk.white(value.toLocaleString());
      case "percentage":
        return this.formatPercentage(value);
      case "duration":
        return this.formatDuration(value);
      case "count":
        return this.formatTrackCount(value);
      case "boolean":
        return value ? chalk.green("✓") : chalk.red("✗");
      default:
        return this.truncateText(value.toString(), 30);
    }
  }

  /**
   * Truncate text to fit column widths
   */
  truncateText(text, maxLength) {
    if (!text) return "";

    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength - 3) + "...";
  }

  /**
   * Create a simple divider
   */
  createDivider(char = "=", length = 80) {
    return chalk.gray(char.repeat(length));
  }

  /**
   * Create a section header
   */
  createSectionHeader(title, subtitle = null) {
    let output = "\n" + chalk.bold.white(title) + "\n";
    output += this.createDivider("=", title.length) + "\n";

    if (subtitle) {
      output += chalk.gray(subtitle) + "\n";
    }

    return output;
  }
}

module.exports = TableDisplay;
