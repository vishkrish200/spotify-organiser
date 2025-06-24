/**
 * Cache Management Module
 *
 * Implements multi-layer caching for Spotify data to optimize performance:
 * - In-memory cache for frequently accessed data
 * - Disk-based cache for persistent storage
 * - Smart cache invalidation and refresh strategies
 * - Metadata caching for tracks, artists, albums, and audio features
 */

const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const chalk = require("chalk");
const ErrorHandler = require("../utils/errorHandler");

class CacheManager {
  constructor(options = {}) {
    // Cache configuration
    this.config = {
      // In-memory cache limits
      maxMemoryItems: options.maxMemoryItems || 10000,
      maxMemorySize: options.maxMemorySize || 50 * 1024 * 1024, // 50MB

      // Cache TTL (time to live) in milliseconds
      trackMetadataTTL: options.trackMetadataTTL || 24 * 60 * 60 * 1000, // 24 hours
      artistGenresTTL: options.artistGenresTTL || 7 * 24 * 60 * 60 * 1000, // 7 days
      audioFeaturesTTL: options.audioFeaturesTTL || 30 * 24 * 60 * 60 * 1000, // 30 days
      analysisResultsTTL: options.analysisResultsTTL || 60 * 60 * 1000, // 1 hour

      // Disk cache settings
      cacheDirectory: options.cacheDirectory || ".cache",
      enableDiskCache: options.enableDiskCache !== false,

      // Performance settings
      cleanupInterval: options.cleanupInterval || 60 * 60 * 1000, // 1 hour
      compressionEnabled: options.compressionEnabled !== false,
    };

    // In-memory cache stores
    this.memoryCache = {
      tracks: new Map(), // Track metadata
      artists: new Map(), // Artist data and genres
      albums: new Map(), // Album metadata
      audioFeatures: new Map(), // Audio features
      analysis: new Map(), // Analysis results
      playlists: new Map(), // Playlist generation cache
    };

    // Cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      memoryUsage: 0,
      diskUsage: 0,
    };

    // Cache cleanup timer
    this.cleanupTimer = null;

    // Initialize cache directory
    this.initializeCache();
  }

  /**
   * Initialize cache system
   */
  async initializeCache() {
    try {
      if (this.config.enableDiskCache) {
        await this.ensureCacheDirectory();
      }

      // Start cleanup timer
      this.startCleanupTimer();

      console.log(chalk.green("✅ Cache system initialized"));
    } catch (error) {
      console.log(
        chalk.yellow("⚠️ Cache initialization failed, continuing without cache")
      );
      this.config.enableDiskCache = false;
    }
  }

  /**
   * Get track metadata with caching
   */
  async getTrackMetadata(trackId, fetchFunction) {
    const cacheKey = `track_${trackId}`;

    // Check memory cache first
    const cached = this.getFromMemory("tracks", cacheKey);
    if (cached && !this.isExpired(cached)) {
      this.stats.hits++;
      return cached.data;
    }

    // Check disk cache
    if (this.config.enableDiskCache) {
      const diskCached = await this.getFromDisk("tracks", cacheKey);
      if (diskCached && !this.isExpired(diskCached)) {
        // Promote to memory cache
        this.setInMemory("tracks", cacheKey, diskCached);
        this.stats.hits++;
        return diskCached.data;
      }
    }

    // Cache miss - fetch data
    this.stats.misses++;
    const data = await fetchFunction(trackId);

    if (data) {
      const cacheItem = this.createCacheItem(
        data,
        this.config.trackMetadataTTL
      );
      this.setInMemory("tracks", cacheKey, cacheItem);

      if (this.config.enableDiskCache) {
        await this.setOnDisk("tracks", cacheKey, cacheItem);
      }
    }

    return data;
  }

  /**
   * Get artist genres with caching
   */
  async getArtistGenres(artistId, fetchFunction) {
    const cacheKey = `artist_${artistId}`;

    const cached = this.getFromMemory("artists", cacheKey);
    if (cached && !this.isExpired(cached)) {
      this.stats.hits++;
      return cached.data;
    }

    if (this.config.enableDiskCache) {
      const diskCached = await this.getFromDisk("artists", cacheKey);
      if (diskCached && !this.isExpired(diskCached)) {
        this.setInMemory("artists", cacheKey, diskCached);
        this.stats.hits++;
        return diskCached.data;
      }
    }

    this.stats.misses++;
    const data = await fetchFunction(artistId);

    if (data) {
      const cacheItem = this.createCacheItem(data, this.config.artistGenresTTL);
      this.setInMemory("artists", cacheKey, cacheItem);

      if (this.config.enableDiskCache) {
        await this.setOnDisk("artists", cacheKey, cacheItem);
      }
    }

    return data;
  }

  /**
   * Get audio features with caching
   */
  async getAudioFeatures(trackIds, fetchFunction) {
    const results = [];
    const uncachedIds = [];

    // Check cache for each track
    for (const trackId of trackIds) {
      const cacheKey = `audio_${trackId}`;
      const cached = this.getFromMemory("audioFeatures", cacheKey);

      if (cached && !this.isExpired(cached)) {
        results.push({ id: trackId, features: cached.data });
        this.stats.hits++;
      } else {
        uncachedIds.push(trackId);
        this.stats.misses++;
      }
    }

    // Fetch uncached audio features in batch
    if (uncachedIds.length > 0) {
      const batchFeatures = await fetchFunction(uncachedIds);

      for (const feature of batchFeatures) {
        if (feature) {
          const cacheKey = `audio_${feature.id}`;
          const cacheItem = this.createCacheItem(
            feature,
            this.config.audioFeaturesTTL
          );

          this.setInMemory("audioFeatures", cacheKey, cacheItem);

          if (this.config.enableDiskCache) {
            await this.setOnDisk("audioFeatures", cacheKey, cacheItem);
          }

          results.push({ id: feature.id, features: feature });
        }
      }
    }

    return results;
  }

  /**
   * Cache analysis results
   */
  async cacheAnalysisResults(analysisKey, data) {
    const cacheKey = `analysis_${analysisKey}`;
    const cacheItem = this.createCacheItem(
      data,
      this.config.analysisResultsTTL
    );

    this.setInMemory("analysis", cacheKey, cacheItem);

    if (this.config.enableDiskCache) {
      await this.setOnDisk("analysis", cacheKey, cacheItem);
    }
  }

  /**
   * Get cached analysis results
   */
  async getCachedAnalysisResults(analysisKey) {
    const cacheKey = `analysis_${analysisKey}`;

    const cached = this.getFromMemory("analysis", cacheKey);
    if (cached && !this.isExpired(cached)) {
      this.stats.hits++;
      return cached.data;
    }

    if (this.config.enableDiskCache) {
      const diskCached = await this.getFromDisk("analysis", cacheKey);
      if (diskCached && !this.isExpired(diskCached)) {
        this.setInMemory("analysis", cacheKey, diskCached);
        this.stats.hits++;
        return diskCached.data;
      }
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Batch cache operations for improved performance
   */
  async batchSet(cacheType, items) {
    const operations = [];

    for (const { key, data, ttl } of items) {
      const cacheItem = this.createCacheItem(data, ttl);
      this.setInMemory(cacheType, key, cacheItem);

      if (this.config.enableDiskCache) {
        operations.push(this.setOnDisk(cacheType, key, cacheItem));
      }
    }

    if (operations.length > 0) {
      await Promise.all(operations);
    }
  }

  /**
   * Create cache item with metadata
   */
  createCacheItem(data, ttl) {
    return {
      data,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      size: this.calculateSize(data),
      hits: 0,
    };
  }

  /**
   * Check if cache item is expired
   */
  isExpired(cacheItem) {
    return Date.now() > cacheItem.expiresAt;
  }

  /**
   * Set item in memory cache with LRU eviction
   */
  setInMemory(cacheType, key, cacheItem) {
    const cache = this.memoryCache[cacheType];

    // Remove if already exists
    if (cache.has(key)) {
      const old = cache.get(key);
      this.stats.memoryUsage -= old.size;
    }

    // Add new item
    cache.set(key, cacheItem);
    this.stats.memoryUsage += cacheItem.size;

    // Evict if necessary
    this.evictIfNecessary(cacheType);
  }

  /**
   * Get item from memory cache
   */
  getFromMemory(cacheType, key) {
    const cache = this.memoryCache[cacheType];
    const item = cache.get(key);

    if (item) {
      item.hits++;
      // Move to end (LRU)
      cache.delete(key);
      cache.set(key, item);
    }

    return item;
  }

  /**
   * Set item on disk cache
   */
  async setOnDisk(cacheType, key, cacheItem) {
    if (!this.config.enableDiskCache) return;

    try {
      const filePath = this.getCacheFilePath(cacheType, key);
      const data = this.config.compressionEnabled
        ? await this.compress(JSON.stringify(cacheItem))
        : JSON.stringify(cacheItem);

      await fs.writeFile(filePath, data);
    } catch (error) {
      // Silently fail disk cache operations
    }
  }

  /**
   * Get item from disk cache
   */
  async getFromDisk(cacheType, key) {
    if (!this.config.enableDiskCache) return null;

    try {
      const filePath = this.getCacheFilePath(cacheType, key);
      const data = await fs.readFile(filePath, "utf8");

      const decompressed = this.config.compressionEnabled
        ? await this.decompress(data)
        : data;

      return JSON.parse(decompressed);
    } catch (error) {
      return null;
    }
  }

  /**
   * Evict items from memory cache if limits exceeded
   */
  evictIfNecessary(cacheType) {
    const cache = this.memoryCache[cacheType];

    // Evict by size
    while (this.stats.memoryUsage > this.config.maxMemorySize) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;

      const item = cache.get(oldestKey);
      cache.delete(oldestKey);
      this.stats.memoryUsage -= item.size;
      this.stats.evictions++;
    }

    // Evict by count
    while (
      cache.size >
      this.config.maxMemoryItems / Object.keys(this.memoryCache).length
    ) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;

      const item = cache.get(oldestKey);
      cache.delete(oldestKey);
      this.stats.memoryUsage -= item.size;
      this.stats.evictions++;
    }
  }

  /**
   * Get cache file path
   */
  getCacheFilePath(cacheType, key) {
    const hash = crypto.createHash("md5").update(key).digest("hex");
    return path.join(this.config.cacheDirectory, cacheType, `${hash}.json`);
  }

  /**
   * Ensure cache directory exists
   */
  async ensureCacheDirectory() {
    for (const cacheType of Object.keys(this.memoryCache)) {
      const dir = path.join(this.config.cacheDirectory, cacheType);
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Calculate approximate size of data
   */
  calculateSize(data) {
    return JSON.stringify(data).length * 2; // Rough estimate in bytes
  }

  /**
   * Start cleanup timer
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Cleanup expired cache items
   */
  cleanup() {
    let cleanedCount = 0;

    for (const [cacheType, cache] of Object.entries(this.memoryCache)) {
      for (const [key, item] of cache.entries()) {
        if (this.isExpired(item)) {
          cache.delete(key);
          this.stats.memoryUsage -= item.size;
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(
        chalk.gray(`🧹 Cache cleanup: removed ${cleanedCount} expired items`)
      );
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalItems = Object.values(this.memoryCache).reduce(
      (sum, cache) => sum + cache.size,
      0
    );

    const hitRate =
      this.stats.hits + this.stats.misses > 0
        ? (
            (this.stats.hits / (this.stats.hits + this.stats.misses)) *
            100
          ).toFixed(1)
        : 0;

    return {
      hitRate: `${hitRate}%`,
      totalItems,
      memoryUsage: `${(this.stats.memoryUsage / 1024 / 1024).toFixed(1)}MB`,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Clear all caches
   */
  async clearAll() {
    for (const cache of Object.values(this.memoryCache)) {
      cache.clear();
    }

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      memoryUsage: 0,
      diskUsage: 0,
    };

    if (this.config.enableDiskCache) {
      try {
        await fs.rmdir(this.config.cacheDirectory, { recursive: true });
        await this.ensureCacheDirectory();
      } catch (error) {
        // Ignore errors
      }
    }

    console.log(chalk.green("✅ All caches cleared"));
  }

  /**
   * Compress data (placeholder for future implementation)
   */
  async compress(data) {
    // For now, just return the data
    // In the future, could implement gzip compression
    return data;
  }

  /**
   * Decompress data (placeholder for future implementation)
   */
  async decompress(data) {
    // For now, just return the data
    return data;
  }

  /**
   * Shutdown cache system
   */
  async shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    console.log(chalk.gray("📤 Cache system shutdown"));
  }
}

module.exports = CacheManager;
