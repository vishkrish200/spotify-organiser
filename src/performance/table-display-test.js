/**
 * Table Display Test
 *
 * Tests and demonstrates the TableDisplay functionality with mock data
 */

const chalk = require("chalk");
const TableDisplay = require("../lib/tableDisplay");

class TableDisplayTest {
  constructor() {
    this.tableDisplay = new TableDisplay();
  }

  /**
   * Run all table display tests
   */
  async runTests() {
    console.log(chalk.cyan("📊 Starting Table Display Tests\n"));

    try {
      console.log(
        this.tableDisplay.createSectionHeader(
          "Table Display Functionality Tests",
          "Demonstrating various table formats for the Spotify Organizer"
        )
      );

      // Test 1: Playlist Preview Table
      console.log(chalk.blue("\n1. Testing Playlist Preview Table"));
      this.testPlaylistPreview();

      // Test 2: Analysis Results Table
      console.log(chalk.blue("\n\n2. Testing Analysis Results Table"));
      this.testAnalysisResults();

      // Test 3: Summary Statistics Table
      console.log(chalk.blue("\n\n3. Testing Summary Statistics Table"));
      this.testSummaryTable();

      // Test 4: Confirmation Dialog Table
      console.log(chalk.blue("\n\n4. Testing Confirmation Dialog Table"));
      this.testConfirmationDialog();

      // Test 5: General Data Table
      console.log(chalk.blue("\n\n5. Testing General Data Table"));
      this.testGeneralDataTable();

      console.log(
        chalk.green("\n✅ All table display tests completed successfully!")
      );
    } catch (error) {
      console.log(chalk.red(`❌ Table display test failed: ${error.message}`));
      throw error;
    }
  }

  /**
   * Test playlist preview table
   */
  testPlaylistPreview() {
    const mockPlaylists = [
      {
        name: "Indie Rock Favorites",
        trackCount: 45,
        categories: ["rock", "indie"],
        status: "new",
        avgDuration: 210000, // 3:30 minutes
        tracks: [
          { name: "Mr. Brightside", artist: "The Killers" },
          { name: "Take Me Out", artist: "Franz Ferdinand" },
          { name: "Seven Nation Army", artist: "The White Stripes" },
        ],
      },
      {
        name: "90s Hip-Hop Classics",
        trackCount: 32,
        categories: ["hip-hop", "90s"],
        status: "existing",
        avgDuration: 195000, // 3:15 minutes
        tracks: [
          { name: "Juicy", artist: "The Notorious B.I.G." },
          { name: "California Love", artist: "2Pac" },
          { name: "C.R.E.A.M.", artist: "Wu-Tang Clan" },
        ],
      },
      {
        name: "Electronic Dance Energy",
        trackCount: 78,
        categories: ["electronic", "dance", "energy"],
        status: "update",
        avgDuration: 180000, // 3:00 minutes
        tracks: [
          { name: "Strobe", artist: "Deadmau5" },
          { name: "Animals", artist: "Martin Garrix" },
          { name: "Bangarang", artist: "Skrillex" },
        ],
      },
      {
        name: "Chill Jazz Instrumentals",
        trackCount: 12,
        categories: ["jazz"],
        status: "new",
        avgDuration: 270000, // 4:30 minutes
        tracks: [
          { name: "Blue in Green", artist: "Miles Davis" },
          { name: "So What", artist: "Miles Davis" },
        ],
      },
    ];

    const playlistTable = this.tableDisplay.createPlaylistPreview(
      mockPlaylists,
      {
        showSamples: true,
        maxSamples: 3,
        showStats: true,
      }
    );

    console.log(playlistTable);

    // Test without samples
    console.log(chalk.gray("\nCompact version (no samples):"));
    const compactTable = this.tableDisplay.createPlaylistPreview(
      mockPlaylists,
      {
        showSamples: false,
        showStats: true,
      }
    );

    console.log(compactTable);
  }

  /**
   * Test analysis results table
   */
  testAnalysisResults() {
    const mockAnalysisData = {
      totalTracks: 500,
      genres: [
        { label: "Indie Rock", genre: "indie rock", trackCount: 85 },
        { label: "Electronic", genre: "electronic", trackCount: 72 },
        { label: "Hip-Hop", genre: "hip hop", trackCount: 65 },
        { label: "Jazz", genre: "jazz", trackCount: 45 },
        { label: "Folk", genre: "folk", trackCount: 38 },
      ],
      decades: [
        { label: "2010s", decade: "2010s", trackCount: 180 },
        { label: "2000s", decade: "2000s", trackCount: 135 },
        { label: "1990s", decade: "1990s", trackCount: 95 },
        { label: "1980s", decade: "1980s", trackCount: 55 },
        { label: "1970s", decade: "1970s", trackCount: 35 },
      ],
      bpmBands: [
        { label: "Medium (100-140)", bpmRange: "100-140 BPM", trackCount: 185 },
        { label: "High (140-180)", bpmRange: "140-180 BPM", trackCount: 165 },
        { label: "Low (60-100)", bpmRange: "60-100 BPM", trackCount: 95 },
        { label: "Very High (180+)", bpmRange: "180+ BPM", trackCount: 55 },
      ],
      energyQuartiles: [
        { label: "High Energy", energyRange: "75-100%", trackCount: 145 },
        { label: "Medium-High", energyRange: "50-75%", trackCount: 135 },
        { label: "Medium-Low", energyRange: "25-50%", trackCount: 115 },
        { label: "Low Energy", energyRange: "0-25%", trackCount: 105 },
      ],
    };

    const analysisTable = this.tableDisplay.createAnalysisResults(
      mockAnalysisData,
      {
        sortBy: "trackCount",
        ascending: false,
        maxRows: 15,
      }
    );

    console.log(analysisTable);
  }

  /**
   * Test summary statistics table
   */
  testSummaryTable() {
    const mockStats = {
      totalTracks: 1247,
      totalDuration: 3856200000, // milliseconds
      uniqueArtists: 485,
      uniqueAlbums: 312,
      averageTrackLength: 210000,
      oldestTrack: new Date("1965-01-01"),
      newestTrack: new Date("2024-03-15"),
      cacheHitRate: 0.85,
      processingTime: 3.8,
      memoryUsage: 145.7,
    };

    const summaryTable = this.tableDisplay.createSummaryTable(mockStats);
    console.log(summaryTable);
  }

  /**
   * Test confirmation dialog table
   */
  testConfirmationDialog() {
    const mockPlaylists = [
      { name: "Indie Rock Favorites", trackCount: 45 },
      { name: "90s Hip-Hop Classics", trackCount: 32 },
      { name: "Electronic Dance Energy", trackCount: 78 },
      { name: "Chill Jazz Instrumentals", trackCount: 12 },
      { name: "Classical Masterpieces", trackCount: 28 },
      { name: "Folk Acoustic Sessions", trackCount: 19 },
      { name: "Metal Mayhem", trackCount: 56 },
      { name: "Pop Hits Collection", trackCount: 67 },
    ];

    const confirmationTable = this.tableDisplay.createConfirmationDialog(
      "create",
      mockPlaylists,
      {
        showDetails: true,
        maxItems: 5,
      }
    );

    console.log(confirmationTable);
  }

  /**
   * Test general data table
   */
  testGeneralDataTable() {
    const mockData = [
      {
        task: "Authentication Setup",
        status: "done",
        duration: 2.5,
        complexity: 3,
        priority: "high",
      },
      {
        task: "Data Ingestion",
        status: "done",
        duration: 4.2,
        complexity: 7,
        priority: "high",
      },
      {
        task: "Analysis Engine",
        status: "done",
        duration: 6.8,
        complexity: 8,
        priority: "high",
      },
      {
        task: "Performance Optimization",
        status: "done",
        duration: 8.4,
        complexity: 9,
        priority: "high",
      },
      {
        task: "Preview System",
        status: "in-progress",
        duration: 0,
        complexity: 6,
        priority: "medium",
      },
      {
        task: "Playlist Generation",
        status: "pending",
        duration: 0,
        complexity: 5,
        priority: "medium",
      },
    ];

    const columns = [
      { key: "task", title: "Task Name", width: 25 },
      {
        key: "status",
        title: "Status",
        width: 12,
        formatter: (value) => {
          const colors = {
            done: chalk.green,
            "in-progress": chalk.yellow,
            pending: chalk.gray,
          };
          return (colors[value] || chalk.white)(value);
        },
      },
      { key: "duration", title: "Duration (h)", width: 12, type: "number" },
      { key: "complexity", title: "Complexity", width: 12, type: "number" },
      {
        key: "priority",
        title: "Priority",
        width: 10,
        formatter: (value) => {
          const colors = {
            high: chalk.red,
            medium: chalk.yellow,
            low: chalk.green,
          };
          return (colors[value] || chalk.white)(value);
        },
      },
    ];

    const dataTable = this.tableDisplay.createDataTable(mockData, columns, {
      title: "Project Development Progress",
      sortColumn: "complexity",
      ascending: false,
    });

    console.log(dataTable);
  }
}

// Run the tests
if (require.main === module) {
  const test = new TableDisplayTest();
  test
    .runTests()
    .then(() => {
      console.log(
        chalk.green("\n🎉 All table display tests completed successfully!")
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(chalk.red("\n💥 Table display tests failed:"), error);
      process.exit(1);
    });
}

module.exports = TableDisplayTest;
