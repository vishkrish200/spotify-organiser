/**
 * Music Analysis Module
 *
 * Implements label discovery algorithm to analyze track metadata and audio features
 * for automatic playlist categorization and grouping
 */

const chalk = require("chalk");
const DatabaseService = require("./database");
const ErrorHandler = require("../utils/errorHandler");

class MusicAnalysis {
  constructor() {
    this.db = new DatabaseService();

    // Analysis configuration
    this.config = {
      minTracksPerLabel: 15, // Minimum tracks to create a meaningful group
      maxLabels: 20, // Maximum number of labels to generate per category
      excludedGenres: ["viral", "deep", "new", "old", "modern", "classic"], // Generic genres to exclude

      // BPM ranges for dance/energy categorization
      bpmRanges: [
        { name: "Slow & Chill", min: 60, max: 90 },
        { name: "Mid-Tempo", min: 90, max: 120 },
        { name: "Upbeat", min: 120, max: 140 },
        { name: "High Energy", min: 140, max: 180 },
        { name: "Electronic/Dance", min: 180, max: 200 },
      ],

      // Energy quartiles for mood categorization
      energyQuartiles: [
        { name: "Mellow", min: 0.0, max: 0.25 },
        { name: "Relaxed", min: 0.25, max: 0.5 },
        { name: "Energetic", min: 0.5, max: 0.75 },
        { name: "High Energy", min: 0.75, max: 1.0 },
      ],
    };

    // Results storage
    this.analysisResults = {
      genres: [],
      decades: [],
      bpmBands: [],
      energyQuartiles: [],
      totalTracks: 0,
      analysisDate: null,
    };
  }

  /**
   * Initialize the analysis module
   */
  async initialize() {
    try {
      console.log(chalk.blue("🔍 Initializing music analysis..."));

      const dbInitialized = await this.db.initialize();
      if (!dbInitialized) {
        throw new Error("Database initialization failed");
      }

      return true;
    } catch (error) {
      ErrorHandler.handleGenericError(error, "Analysis Initialization");
      return false;
    }
  }

  /**
   * Run complete analysis on the music library
   */
  async analyzeLibrary(options = {}) {
    const { minTracks = this.config.minTracksPerLabel } = options;

    try {
      console.log(chalk.cyan("🎵 Starting music library analysis..."));
      console.log(
        chalk.gray("Discovering patterns in genres, decades, tempo, and energy")
      );

      const startTime = Date.now();

      // Get all tracks with metadata
      const tracks = await this.getAllTracksWithMetadata();

      if (!tracks || tracks.length === 0) {
        throw new Error(
          "No tracks found in database. Run 'scan' command first."
        );
      }

      console.log(chalk.white(`📊 Analyzing ${tracks.length} tracks...`));
      this.analysisResults.totalTracks = tracks.length;

      // Run all analyses in parallel for better performance
      const [genres, decades, bpmBands, energyQuartiles] = await Promise.all([
        this.analyzeGenres(tracks, minTracks),
        this.analyzeDecades(tracks, minTracks),
        this.analyzeBPMBands(tracks, minTracks),
        this.analyzeEnergyQuartiles(tracks, minTracks),
      ]);

      // Store results
      this.analysisResults = {
        genres,
        decades,
        bpmBands,
        energyQuartiles,
        totalTracks: tracks.length,
        analysisDate: new Date().toISOString(),
      };

      const duration = (Date.now() - startTime) / 1000;
      console.log(
        chalk.green(`✅ Analysis completed in ${duration.toFixed(1)} seconds`)
      );

      return this.analysisResults;
    } catch (error) {
      ErrorHandler.handleGenericError(error, "Library Analysis");
      throw error;
    }
  }

  /**
   * Analyze genre distribution and find meaningful genre groups
   */
  async analyzeGenres(tracks, minTracks) {
    console.log(chalk.blue("🎭 Analyzing genre distribution..."));

    // Extract all genres from tracks
    const genreMap = new Map();

    tracks.forEach((track) => {
      if (track.artists) {
        track.artists.forEach((artist) => {
          if (artist.genres) {
            artist.genres.forEach((genreName) => {
              const genre = genreName.toLowerCase().trim();

              // Skip excluded generic genres
              if (
                this.config.excludedGenres.some((excluded) =>
                  genre.includes(excluded)
                )
              ) {
                return;
              }

              if (!genreMap.has(genre)) {
                genreMap.set(genre, []);
              }
              genreMap.get(genre).push(track.id);
            });
          }
        });
      }
    });

    // Convert to array and filter by minimum track count
    const genreGroups = Array.from(genreMap.entries())
      .map(([genre, trackIds]) => ({
        label: this.formatGenreLabel(genre),
        genre,
        trackCount: trackIds.length,
        trackIds: [...new Set(trackIds)], // Remove duplicates
      }))
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => b.trackCount - a.trackCount)
      .slice(0, this.config.maxLabels);

    console.log(chalk.gray(`   Found ${genreGroups.length} genre groups`));
    return genreGroups;
  }

  /**
   * Analyze decade distribution from release dates
   */
  async analyzeDecades(tracks, minTracks) {
    console.log(chalk.blue("📅 Analyzing decade distribution..."));

    const decadeMap = new Map();

    tracks.forEach((track) => {
      if (track.album && track.album.releaseYear) {
        const year = track.album.releaseYear;
        const decade = Math.floor(year / 10) * 10;
        const decadeLabel = `${decade}s`;

        if (!decadeMap.has(decadeLabel)) {
          decadeMap.set(decadeLabel, []);
        }
        decadeMap.get(decadeLabel).push(track.id);
      }
    });

    const decadeGroups = Array.from(decadeMap.entries())
      .map(([decade, trackIds]) => ({
        label: decade,
        decade,
        trackCount: trackIds.length,
        trackIds: [...new Set(trackIds)],
      }))
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => parseInt(b.decade) - parseInt(a.decade));

    console.log(chalk.gray(`   Found ${decadeGroups.length} decade groups`));
    return decadeGroups;
  }

  /**
   * Analyze BPM (tempo) distribution and create tempo bands
   */
  async analyzeBPMBands(tracks, minTracks) {
    console.log(chalk.blue("🥁 Analyzing BPM distribution..."));

    // Filter tracks with audio features
    const tracksWithBPM = tracks.filter(
      (track) => track.audioFeatures && track.audioFeatures.tempo
    );

    if (tracksWithBPM.length === 0) {
      console.log(
        chalk.yellow(
          "   No audio features available. Run scan with --extended-mode"
        )
      );
      return [];
    }

    const bpmGroups = this.config.bpmRanges
      .map((range) => {
        const tracksInRange = tracksWithBPM.filter(
          (track) =>
            track.audioFeatures.tempo >= range.min &&
            track.audioFeatures.tempo < range.max
        );

        return {
          label: range.name,
          bpmRange: `${range.min}-${range.max} BPM`,
          trackCount: tracksInRange.length,
          trackIds: tracksInRange.map((t) => t.id),
          avgBPM:
            tracksInRange.length > 0
              ? Math.round(
                  tracksInRange.reduce(
                    (sum, t) => sum + t.audioFeatures.tempo,
                    0
                  ) / tracksInRange.length
                )
              : 0,
        };
      })
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => b.trackCount - a.trackCount);

    console.log(chalk.gray(`   Found ${bpmGroups.length} BPM groups`));
    return bpmGroups;
  }

  /**
   * Analyze energy distribution and create energy quartiles
   */
  async analyzeEnergyQuartiles(tracks, minTracks) {
    console.log(chalk.blue("⚡ Analyzing energy distribution..."));

    // Filter tracks with audio features
    const tracksWithEnergy = tracks.filter(
      (track) =>
        track.audioFeatures && typeof track.audioFeatures.energy === "number"
    );

    if (tracksWithEnergy.length === 0) {
      console.log(
        chalk.yellow(
          "   No audio features available. Run scan with --extended-mode"
        )
      );
      return [];
    }

    const energyGroups = this.config.energyQuartiles
      .map((quartile) => {
        const tracksInRange = tracksWithEnergy.filter(
          (track) =>
            track.audioFeatures.energy >= quartile.min &&
            track.audioFeatures.energy < quartile.max
        );

        return {
          label: quartile.name,
          energyRange: `${Math.round(quartile.min * 100)}-${Math.round(
            quartile.max * 100
          )}%`,
          trackCount: tracksInRange.length,
          trackIds: tracksInRange.map((t) => t.id),
          avgEnergy:
            tracksInRange.length > 0
              ? Math.round(
                  (tracksInRange.reduce(
                    (sum, t) => sum + t.audioFeatures.energy,
                    0
                  ) /
                    tracksInRange.length) *
                    100
                )
              : 0,
        };
      })
      .filter((group) => group.trackCount >= minTracks)
      .sort((a, b) => b.trackCount - a.trackCount);

    console.log(chalk.gray(`   Found ${energyGroups.length} energy groups`));
    return energyGroups;
  }

  /**
   * Get all tracks with related metadata from database
   */
  async getAllTracksWithMetadata() {
    try {
      // This would use Prisma to get tracks with related data
      // For now, using a simplified approach
      const tracks = await this.db.getAllTracksWithMetadata();
      return tracks;
    } catch (error) {
      throw new Error(`Failed to fetch tracks: ${error.message}`);
    }
  }

  /**
   * Format genre names for display
   */
  formatGenreLabel(genre) {
    return genre
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Get analysis results
   */
  getResults() {
    return this.analysisResults;
  }

  /**
   * Generate summary statistics
   */
  generateSummary() {
    const results = this.analysisResults;

    return {
      totalTracks: results.totalTracks,
      totalGroups:
        results.genres.length +
        results.decades.length +
        results.bpmBands.length +
        results.energyQuartiles.length,
      categories: {
        genres: results.genres.length,
        decades: results.decades.length,
        bpmBands: results.bpmBands.length,
        energyQuartiles: results.energyQuartiles.length,
      },
      analysisDate: results.analysisDate,
    };
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.db) {
      await this.db.disconnect();
    }
  }
}

module.exports = MusicAnalysis;
