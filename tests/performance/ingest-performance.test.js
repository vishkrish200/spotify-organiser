/**
 * Performance Tests for Spotify Data Ingest Module
 *
 * Tests system performance under various loads and identifies optimization opportunities
 */

const SpotifyIngest = require("../../src/lib/ingest");
const DatabaseService = require("../../src/lib/database");
const { performance } = require("perf_hooks");

// Mock external dependencies for controlled testing
jest.mock("../../src/lib/auth");
jest.mock("../../src/utils/errorHandler");
jest.mock("../../src/utils/retryHandler");

describe("Data Ingest Performance Tests", () => {
  let ingest;
  let db;
  let mockSpotifyApi;
  let performanceMetrics;

  beforeAll(() => {
    // Set extended timeout for performance tests
    jest.setTimeout(30000);
  });

  beforeEach(() => {
    // Initialize performance tracking
    performanceMetrics = {
      startTime: 0,
      endTime: 0,
      memoryStart: process.memoryUsage(),
      memoryPeak: process.memoryUsage(),
      memoryEnd: process.memoryUsage(),
      apiCalls: 0,
      dbQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };

    // Mock Spotify API with realistic response times
    mockSpotifyApi = {
      getMySavedTracks: jest.fn(),
      getArtists: jest.fn(),
      getAudioFeaturesForTracks: jest.fn(),
      getMe: jest.fn().mockResolvedValue({
        body: { id: "test_user", display_name: "Test User" },
      }),
    };

    // Mock ingest instance
    ingest = new SpotifyIngest();
    ingest.spotifyApi = mockSpotifyApi;
    ingest.spotifyUserId = "test_user";

    // Mock database with performance tracking
    db = {
      initialize: jest.fn().mockResolvedValue(true),
      createScanRecord: jest.fn().mockResolvedValue("scan_123"),
      storeTracks: jest.fn().mockImplementation(async (tracks) => {
        performanceMetrics.dbQueries++;
        // Simulate database write time
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { tracksAdded: tracks.length, tracksUpdated: 0 };
      }),
      storeArtistGenres: jest.fn().mockImplementation(async (genres) => {
        performanceMetrics.dbQueries++;
        await new Promise((resolve) => setTimeout(resolve, 3));
        return Object.keys(genres).length;
      }),
      storeAudioFeatures: jest.fn().mockImplementation(async (features) => {
        performanceMetrics.dbQueries++;
        await new Promise((resolve) => setTimeout(resolve, 3));
        return Object.keys(features).length;
      }),
      updateScanProgress: jest.fn().mockResolvedValue(true),
      completeScan: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(true),
    };
    ingest.db = db;

    // Suppress console output during tests
    jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  describe("Load Testing - Dataset Size Scalability", () => {
    const testSizes = [50, 500, 1500, 5000]; // Realistic Spotify library sizes

    testSizes.forEach((size) => {
      test(`should handle ${size} tracks efficiently`, async () => {
        // Setup mock data for specific size
        const mockTracks = generateMockTracks(size);
        setupSpotifyApiMocks(mockTracks, size);

        const startTime = performance.now();
        const startMemory = process.memoryUsage();

        // Run the ingest operation
        const result = await ingest.fetchAllLikedSongs();

        const endTime = performance.now();
        const endMemory = process.memoryUsage();
        const duration = endTime - startTime;

        // Performance assertions
        expect(result.success).toBe(true);
        expect(result.tracks).toHaveLength(size);

        // Time performance (should be under 3 minutes for target 1500 tracks)
        const timePerTrack = duration / size;
        const projectedTimeFor1500 = (timePerTrack * 1500) / 1000; // Convert to seconds

        console.log(`Performance for ${size} tracks:`);
        console.log(`  Total time: ${(duration / 1000).toFixed(2)}s`);
        console.log(`  Time per track: ${timePerTrack.toFixed(2)}ms`);
        console.log(
          `  Projected time for 1500 tracks: ${projectedTimeFor1500.toFixed(
            2
          )}s`
        );
        console.log(
          `  Memory used: ${(
            (endMemory.heapUsed - startMemory.heapUsed) /
            1024 /
            1024
          ).toFixed(2)}MB`
        );

        // Performance targets
        if (size === 1500) {
          expect(projectedTimeFor1500).toBeLessThan(180); // 3 minutes target
        }

        // Memory efficiency
        const memoryPerTrack =
          (endMemory.heapUsed - startMemory.heapUsed) / size;
        expect(memoryPerTrack).toBeLessThan(50000); // Less than 50KB per track

        // API efficiency
        const expectedApiCalls = Math.ceil(size / 50); // 50 tracks per API call
        expect(performanceMetrics.apiCalls).toBeLessThanOrEqual(
          expectedApiCalls + 2
        ); // Allow some overhead
      });
    });

    test("should maintain linear performance scaling", async () => {
      const performanceData = [];

      for (const size of [100, 500, 1000]) {
        const mockTracks = generateMockTracks(size);
        setupSpotifyApiMocks(mockTracks, size);

        const startTime = performance.now();
        await ingest.fetchAllLikedSongs();
        const endTime = performance.now();

        performanceData.push({
          size,
          duration: endTime - startTime,
          timePerTrack: (endTime - startTime) / size,
        });
      }

      // Check that performance scaling is roughly linear
      const smallToMedium =
        performanceData[1].timePerTrack / performanceData[0].timePerTrack;
      const mediumToLarge =
        performanceData[2].timePerTrack / performanceData[1].timePerTrack;

      // Performance should not degrade significantly (within 50% variance)
      expect(smallToMedium).toBeLessThan(1.5);
      expect(mediumToLarge).toBeLessThan(1.5);
    });
  });

  describe("Caching Efficiency Tests", () => {
    test("should efficiently cache tracks in batches", async () => {
      const trackCount = 1000;
      const mockTracks = generateMockTracks(trackCount);
      setupSpotifyApiMocks(mockTracks, trackCount);

      const startTime = performance.now();
      await ingest.fetchAllLikedSongs();
      const endTime = performance.now();

      // Should use batching for database operations
      const expectedBatches = Math.ceil(trackCount / 50); // 50 tracks per API call = 1 batch per API call
      expect(performanceMetrics.dbQueries).toBeLessThanOrEqual(
        expectedBatches * 2
      ); // Allow some overhead

      // Caching should complete quickly
      const cachingTime = endTime - startTime;
      const timePerTrack = cachingTime / trackCount;
      expect(timePerTrack).toBeLessThan(10); // Less than 10ms per track including network
    });

    test("should handle duplicate track detection efficiently", async () => {
      const trackCount = 500;
      const mockTracks = generateMockTracks(trackCount, true); // Include duplicates
      setupSpotifyApiMocks(mockTracks, trackCount);

      const startTime = performance.now();
      await ingest.fetchAllLikedSongs();
      const endTime = performance.now();

      // Should not significantly impact performance with duplicates
      const duration = endTime - startTime;
      const timePerTrack = duration / trackCount;
      expect(timePerTrack).toBeLessThan(15); // Allow slight overhead for duplicate handling
    });
  });

  describe("API Throughput Tests", () => {
    test("should optimize batch request handling", async () => {
      const trackCount = 1500;
      const mockTracks = generateMockTracks(trackCount);
      setupSpotifyApiMocks(mockTracks, trackCount);

      // Track API call patterns
      let apiCallTimes = [];
      mockSpotifyApi.getMySavedTracks.mockImplementation(async (params) => {
        const callStart = performance.now();
        performanceMetrics.apiCalls++;

        // Simulate realistic API response time
        await new Promise((resolve) =>
          setTimeout(resolve, 100 + Math.random() * 50)
        );

        const callEnd = performance.now();
        apiCallTimes.push(callEnd - callStart);

        return createMockApiResponse(params, mockTracks);
      });

      await ingest.fetchAllLikedSongs();

      // API efficiency checks
      const avgApiTime =
        apiCallTimes.reduce((a, b) => a + b, 0) / apiCallTimes.length;
      const maxApiTime = Math.max(...apiCallTimes);

      console.log(`API Performance:`);
      console.log(`  Total API calls: ${performanceMetrics.apiCalls}`);
      console.log(`  Average API time: ${avgApiTime.toFixed(2)}ms`);
      console.log(`  Max API time: ${maxApiTime.toFixed(2)}ms`);

      // Should use appropriate batch sizes
      const expectedCalls = Math.ceil(trackCount / 50);
      expect(performanceMetrics.apiCalls).toBe(expectedCalls);

      // API calls should be reasonably fast
      expect(avgApiTime).toBeLessThan(200); // Average under 200ms
      expect(maxApiTime).toBeLessThan(500); // No single call over 500ms
    });

    test("should handle rate limiting gracefully", async () => {
      const trackCount = 200;
      const mockTracks = generateMockTracks(trackCount);

      // Mock rate limiting scenario
      let callCount = 0;
      mockSpotifyApi.getMySavedTracks.mockImplementation(async (params) => {
        callCount++;
        if (callCount === 3) {
          // Simulate rate limit on 3rd call
          const error = new Error("Rate limited");
          error.statusCode = 429;
          throw error;
        }
        return createMockApiResponse(params, mockTracks);
      });

      // Should handle rate limiting without failing
      const result = await ingest.fetchAllLikedSongs();
      expect(result.success).toBe(true);
    });
  });

  describe("Memory Usage Tests", () => {
    test("should maintain reasonable memory usage", async () => {
      const trackCount = 2000;
      const mockTracks = generateMockTracks(trackCount);
      setupSpotifyApiMocks(mockTracks, trackCount);

      const memoryBefore = process.memoryUsage();

      await ingest.fetchAllLikedSongs();

      const memoryAfter = process.memoryUsage();
      const memoryIncrease = memoryAfter.heapUsed - memoryBefore.heapUsed;
      const memoryPerTrack = memoryIncrease / trackCount;

      console.log(`Memory Usage:`);
      console.log(
        `  Total increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`
      );
      console.log(`  Per track: ${(memoryPerTrack / 1024).toFixed(2)}KB`);

      // Memory should not grow excessively
      expect(memoryIncrease).toBeLessThan(150 * 1024 * 1024); // Less than 150MB total
      expect(memoryPerTrack).toBeLessThan(75 * 1024); // Less than 75KB per track
    });

    test("should prevent memory leaks in long operations", async () => {
      const initialMemory = process.memoryUsage();

      // Run multiple small operations
      for (let i = 0; i < 5; i++) {
        const mockTracks = generateMockTracks(100);
        setupSpotifyApiMocks(mockTracks, 100);
        await ingest.fetchAllLikedSongs();

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory growth should be minimal after multiple operations
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024); // Less than 50MB growth
    });
  });

  describe("Extended Mode Performance", () => {
    test("should efficiently fetch genres and audio features", async () => {
      const trackCount = 500;
      const mockTracks = generateMockTracks(trackCount);
      setupSpotifyApiMocks(mockTracks, trackCount);
      setupExtendedModeData(mockTracks);

      const startTime = performance.now();
      const result = await ingest.fetchAllLikedSongs({ extendedMode: true });
      const endTime = performance.now();

      expect(result.success).toBe(true);
      expect(result.extendedData.genres).toBeDefined();
      expect(result.extendedData.audioFeatures).toBeDefined();

      // Extended mode should not significantly impact performance
      const duration = endTime - startTime;
      const timePerTrack = duration / trackCount;
      expect(timePerTrack).toBeLessThan(25); // Allow more time for extended data
    });
  });

  // Helper functions for generating test data
  function generateMockTracks(count, includeDuplicates = false) {
    const tracks = [];
    const trackPool = [];

    for (let i = 0; i < (includeDuplicates ? count * 0.8 : count); i++) {
      trackPool.push({
        track: {
          id: `track_${i}`,
          name: `Track ${i}`,
          artists: [
            { id: `artist_${i % 100}`, name: `Artist ${i % 100}` },
            {
              id: `artist_${(i + 50) % 100}`,
              name: `Artist ${(i + 50) % 100}`,
            },
          ],
          album: {
            id: `album_${i % 200}`,
            name: `Album ${i % 200}`,
            release_date: "2023-01-01",
          },
          duration_ms: 180000 + i * 1000,
          popularity: Math.floor(Math.random() * 100),
        },
        added_at: new Date(Date.now() - i * 86400000).toISOString(),
      });
    }

    // Add duplicates if requested
    if (includeDuplicates) {
      for (let i = 0; i < count * 0.2; i++) {
        tracks.push(trackPool[Math.floor(Math.random() * trackPool.length)]);
      }
    }

    tracks.push(...trackPool);
    return tracks.slice(0, count);
  }

  function setupSpotifyApiMocks(mockTracks, totalCount) {
    mockSpotifyApi.getMySavedTracks.mockImplementation(async (params) => {
      performanceMetrics.apiCalls++;
      const { limit = 50, offset = 0 } = params;

      const items = mockTracks.slice(offset, offset + limit);
      const hasNext = offset + limit < totalCount;

      return {
        body: {
          items,
          total: totalCount,
          next: hasNext
            ? `https://api.spotify.com/v1/me/tracks?offset=${
                offset + limit
              }&limit=${limit}`
            : null,
          offset,
          limit,
        },
      };
    });
  }

  function setupExtendedModeData(mockTracks) {
    // Mock artist genres
    mockSpotifyApi.getArtists.mockImplementation(async (artistIds) => {
      return {
        body: {
          artists: artistIds.map((id) => ({
            id,
            genres: ["rock", "pop", "alternative"],
          })),
        },
      };
    });

    // Mock audio features
    mockSpotifyApi.getAudioFeaturesForTracks.mockImplementation(
      async (trackIds) => {
        return {
          body: {
            audio_features: trackIds.map((id) => ({
              id,
              danceability: Math.random(),
              energy: Math.random(),
              valence: Math.random(),
              tempo: 120 + Math.random() * 60,
            })),
          },
        };
      }
    );
  }

  function createMockApiResponse(params, mockTracks) {
    const { limit = 50, offset = 0 } = params;
    const items = mockTracks.slice(offset, offset + limit);
    const hasNext = offset + limit < mockTracks.length;

    return {
      body: {
        items,
        total: mockTracks.length,
        next: hasNext ? `next_url_${offset + limit}` : null,
        offset,
        limit,
      },
    };
  }
});
