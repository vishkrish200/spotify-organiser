-- CreateTable
CREATE TABLE "tracks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "popularity" INTEGER NOT NULL,
    "preview_url" TEXT,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "is_local" BOOLEAN NOT NULL DEFAULT false,
    "added_at" DATETIME NOT NULL,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "album_id" TEXT NOT NULL,
    CONSTRAINT "tracks_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "albums" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "release_date" TEXT NOT NULL,
    "release_year" INTEGER NOT NULL,
    "total_tracks" INTEGER NOT NULL,
    "album_type" TEXT NOT NULL,
    "image_url" TEXT,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "artists" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "track_artists" (
    "track_id" TEXT NOT NULL,
    "artist_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("track_id", "artist_id"),
    CONSTRAINT "track_artists_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "track_artists_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audio_features" (
    "track_id" TEXT NOT NULL PRIMARY KEY,
    "danceability" REAL NOT NULL,
    "energy" REAL NOT NULL,
    "key" INTEGER NOT NULL,
    "loudness" REAL NOT NULL,
    "mode" INTEGER NOT NULL,
    "speechiness" REAL NOT NULL,
    "acousticness" REAL NOT NULL,
    "instrumentalness" REAL NOT NULL,
    "liveness" REAL NOT NULL,
    "valence" REAL NOT NULL,
    "tempo" REAL NOT NULL,
    "time_signature" INTEGER NOT NULL,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "audio_features_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "genres" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "track_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "artist_genres" (
    "artist_id" TEXT NOT NULL,
    "genre_id" INTEGER NOT NULL,

    PRIMARY KEY ("artist_id", "genre_id"),
    CONSTRAINT "artist_genres_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artist_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scan_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scan_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_tracks" INTEGER NOT NULL,
    "tracks_processed" INTEGER NOT NULL,
    "tracks_added" INTEGER NOT NULL,
    "tracks_updated" INTEGER NOT NULL,
    "genres_fetched" INTEGER NOT NULL DEFAULT 0,
    "audio_features_fetched" INTEGER NOT NULL DEFAULT 0,
    "start_time" DATETIME NOT NULL,
    "end_time" DATETIME,
    "duration" INTEGER,
    "error_message" TEXT,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "spotify_user_id" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "generated_playlists" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "spotify_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "category_type" TEXT NOT NULL,
    "category_value" TEXT NOT NULL,
    "track_count" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "can_rollback" BOOLEAN NOT NULL DEFAULT true,
    "rollback_expiry" DATETIME
);

-- CreateTable
CREATE TABLE "playlist_tracks" (
    "playlist_id" INTEGER NOT NULL,
    "track_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("playlist_id", "track_id"),
    CONSTRAINT "playlist_tracks_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "generated_playlists" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "playlist_tracks_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rollback_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "spotify_user_id" TEXT NOT NULL,
    "playlists_created" INTEGER NOT NULL DEFAULT 0,
    "tracks_affected" INTEGER NOT NULL DEFAULT 0,
    "start_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" DATETIME,
    "expiry_time" DATETIME NOT NULL,
    "rolled_back_at" DATETIME,
    "rollback_reason" TEXT
);

-- CreateTable
CREATE TABLE "rollback_operations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operation_type" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "operation_data" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rollback_attempts" INTEGER NOT NULL DEFAULT 0,
    "rollback_error" TEXT,
    "rolled_back_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" TEXT NOT NULL,
    CONSTRAINT "rollback_operations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "rollback_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_config" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "genres_name_key" ON "genres"("name");

-- CreateIndex
CREATE UNIQUE INDEX "generated_playlists_spotify_id_key" ON "generated_playlists"("spotify_id");
