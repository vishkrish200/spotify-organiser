/**
 * Streaming Data Processing Integration Test
 *
 * Tests the StreamProcessor integration with SpotifyIngest and MusicAnalysis modules
 * to verify streaming data processing is working correctly for large datasets
 */

const chalk = require("chalk");
const SpotifyIngest = require("../lib/ingest");
const MusicAnalysis = require("../lib/analysis");
const StreamProcessor = require("../lib/streamProcessor");

class StreamingTest {
  constructor() {
    this.streamProcessor = new StreamProcessor();
  }

  /**
   * Run comprehensive streaming tests
   */
  async runTests() {
    console.log(chalk.cyan("🌊 Starting Streaming Data Processing Tests\n"));

    try {
      // Test 1: Basic StreamProcessor functionality
      console.log(chalk.blue("Test 1: Basic StreamProcessor functionality..."));
      await this.testBasicStreaming();

      // Test 2: Array streaming
      console.log(chalk.blue("\nTest 2: Array streaming with processing..."));
      await this.testArrayStreaming();

      // Test 3: Batch processing with streaming
      console.log(chalk.blue("\nTest 3: Batch processing with streaming..."));
      await this.testBatchStreaming();

      // Test 4: Pipeline with multiple processors
      console.log(
        chalk.blue("\nTest 4: Complex pipeline with multiple processors...")
      );
      await this.testComplexPipeline();

      // Test 5: Integration with existing modules (mock data)
      console.log(chalk.blue("\nTest 5: Integration with existing modules..."));
      await this.testModuleIntegration();

      console.log(chalk.green("\n✅ All streaming tests passed successfully!"));

      // Display final metrics
      const metrics = this.streamProcessor.getOverallMetrics();
      console.log(chalk.cyan("\n📊 Final Streaming Metrics:"));
      console.log(`   • Total streams created: ${metrics.totalStreams}`);
      console.log(`   • Items processed: ${metrics.itemsProcessed}`);
      console.log(`   • Average throughput: ${metrics.throughput} items/sec`);
      console.log(`   • Processing efficiency: ${metrics.efficiency}%`);
      console.log(`   • Backpressure events: ${metrics.backpressureEvents}`);
    } catch (error) {
      console.log(chalk.red(`❌ Streaming test failed: ${error.message}`));
      throw error;
    } finally {
      await this.streamProcessor.shutdown();
    }
  }

  /**
   * Test basic streaming functionality
   */
  async testBasicStreaming() {
    const mockData = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      value: Math.random() * 100,
    }));

    const result = await this.streamProcessor.createPipeline(
      mockData,
      [
        // Simple transform processor
        (item) => ({
          ...item,
          processed: true,
          doubled: item.value * 2,
        }),
      ],
      (processedItem) => {
        // Destination just validates the processing
        if (
          !processedItem.processed ||
          processedItem.doubled !== processedItem.value * 2
        ) {
          throw new Error("Processing validation failed");
        }
      }
    );

    if (!result.success) {
      throw new Error(`Basic streaming test failed: ${result.error}`);
    }

    console.log(
      chalk.green(`   ✅ Processed ${mockData.length} items successfully`)
    );
  }

  /**
   * Test array streaming with complex processing
   */
  async testArrayStreaming() {
    const tracks = Array.from({ length: 200 }, (_, i) => ({
      id: `track_${i}`,
      name: `Track ${i}`,
      artist: `Artist ${i % 10}`,
      genre: ["rock", "pop", "jazz", "electronic"][i % 4],
      duration: 180000 + i * 1000,
    }));

    let processedCount = 0;

    const result = await this.streamProcessor.createPipeline(
      tracks,
      [
        // Filter only rock and pop tracks
        (track) => {
          if (track.genre === "rock" || track.genre === "pop") {
            return {
              ...track,
              filtered: true,
              durationMinutes: Math.round(track.duration / 60000),
            };
          }
          return null; // Filter out
        },
        // Remove null values
        (track) => (track !== null ? track : undefined),
      ],
      (track) => {
        if (track) {
          processedCount++;
        }
      }
    );

    if (!result.success) {
      throw new Error(`Array streaming test failed: ${result.error}`);
    }

    console.log(
      chalk.green(`   ✅ Filtered and processed ${processedCount} tracks`)
    );
  }

  /**
   * Test batch processing with streaming
   */
  async testBatchStreaming() {
    const largeDataset = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      category: ["A", "B", "C"][i % 3],
      value: Math.random() * 1000,
    }));

    const batchResults = [];

    const result = await this.streamProcessor.createPipeline(
      largeDataset,
      [
        {
          type: "batch",
          batchSize: 50,
          handler: async (batch) => {
            // Simulate some async processing
            await new Promise((resolve) => setTimeout(resolve, 10));

            const summary = {
              batchSize: batch.length,
              categories: {},
              avgValue: 0,
            };

            batch.forEach((item) => {
              summary.categories[item.category] =
                (summary.categories[item.category] || 0) + 1;
              summary.avgValue += item.value;
            });

            summary.avgValue /= batch.length;
            return summary;
          },
        },
      ],
      (batchSummary) => {
        batchResults.push(batchSummary);
      },
      {
        batch: { batchSize: 50 },
      }
    );

    if (!result.success) {
      throw new Error(`Batch streaming test failed: ${result.error}`);
    }

    console.log(
      chalk.green(
        `   ✅ Processed ${batchResults.length} batches from ${largeDataset.length} items`
      )
    );
  }

  /**
   * Test complex pipeline with multiple processors
   */
  async testComplexPipeline() {
    const musicData = Array.from({ length: 300 }, (_, i) => ({
      id: `song_${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i % 20}`,
      album: `Album ${i % 50}`,
      year: 1990 + (i % 30),
      duration: 120 + (i % 240), // 2-6 minutes
      genre: ["rock", "pop", "jazz", "classical", "electronic"][i % 5],
      energy: Math.random(),
      tempo: 80 + Math.random() * 120, // 80-200 BPM
    }));

    const analysisResults = {
      genreCounts: {},
      decadeCounts: {},
      totalProcessed: 0,
    };

    const result = await this.streamProcessor.createPipeline(
      musicData,
      [
        // Stage 1: Enrich with decade information
        (song) => ({
          ...song,
          decade: Math.floor(song.year / 10) * 10,
          durationMinutes: Math.round(song.duration / 60),
        }),

        // Stage 2: Batch analysis
        {
          type: "batch",
          batchSize: 100,
          handler: async (songs) => {
            const batchAnalysis = {
              genres: {},
              decades: {},
              avgTempo: 0,
              avgEnergy: 0,
              count: songs.length,
            };

            songs.forEach((song) => {
              batchAnalysis.genres[song.genre] =
                (batchAnalysis.genres[song.genre] || 0) + 1;
              batchAnalysis.decades[song.decade] =
                (batchAnalysis.decades[song.decade] || 0) + 1;
              batchAnalysis.avgTempo += song.tempo;
              batchAnalysis.avgEnergy += song.energy;
            });

            batchAnalysis.avgTempo /= songs.length;
            batchAnalysis.avgEnergy /= songs.length;

            return batchAnalysis;
          },
        },
      ],
      (batchAnalysis) => {
        // Aggregate results
        Object.keys(batchAnalysis.genres).forEach((genre) => {
          analysisResults.genreCounts[genre] =
            (analysisResults.genreCounts[genre] || 0) +
            batchAnalysis.genres[genre];
        });

        Object.keys(batchAnalysis.decades).forEach((decade) => {
          analysisResults.decadeCounts[decade] =
            (analysisResults.decadeCounts[decade] || 0) +
            batchAnalysis.decades[decade];
        });

        analysisResults.totalProcessed += batchAnalysis.count;
      }
    );

    if (!result.success) {
      throw new Error(`Complex pipeline test failed: ${result.error}`);
    }

    console.log(
      chalk.green(`   ✅ Analyzed ${analysisResults.totalProcessed} songs`)
    );
    console.log(
      chalk.gray(
        `      • Genres found: ${
          Object.keys(analysisResults.genreCounts).length
        }`
      )
    );
    console.log(
      chalk.gray(
        `      • Decades found: ${
          Object.keys(analysisResults.decadeCounts).length
        }`
      )
    );
  }

  /**
   * Test integration with existing modules (using mock data)
   */
  async testModuleIntegration() {
    // Test SpotifyIngest streaming capabilities
    console.log(chalk.gray("   Testing SpotifyIngest integration..."));
    const ingest = new SpotifyIngest();

    // Verify StreamProcessor is initialized
    if (!ingest.streamProcessor) {
      throw new Error("SpotifyIngest should have StreamProcessor initialized");
    }

    console.log(
      chalk.green("   ✅ SpotifyIngest has StreamProcessor integrated")
    );

    // Test MusicAnalysis streaming capabilities
    console.log(chalk.gray("   Testing MusicAnalysis integration..."));
    const analysis = new MusicAnalysis();

    // Verify StreamProcessor is initialized
    if (!analysis.streamProcessor) {
      throw new Error("MusicAnalysis should have StreamProcessor initialized");
    }

    console.log(
      chalk.green("   ✅ MusicAnalysis has StreamProcessor integrated")
    );

    // Test streaming metrics collection
    const ingestMetrics = ingest.getStreamMetrics();
    const analysisMetrics = analysis.getStreamMetrics();

    if (!ingestMetrics || !analysisMetrics) {
      throw new Error("StreamProcessor metrics should be available");
    }

    console.log(chalk.green("   ✅ StreamProcessor metrics are accessible"));

    // Cleanup
    await ingest.cleanup();
    await analysis.cleanup();

    console.log(chalk.green("   ✅ Module integration test completed"));
  }
}

// Run the tests
if (require.main === module) {
  const test = new StreamingTest();
  test
    .runTests()
    .then(() => {
      console.log(
        chalk.green(
          "\n🎉 All streaming integration tests completed successfully!"
        )
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(chalk.red("\n💥 Streaming tests failed:"), error);
      process.exit(1);
    });
}

module.exports = StreamingTest;
