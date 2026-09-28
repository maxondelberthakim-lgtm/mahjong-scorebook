-- Mahjong Scorebook — D1 schema (idempotent; safe to re-run)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ruleset TEXT,
  finished INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS games_user_synced ON games(user_id, synced_at);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT,
  ruleset TEXT,
  tier TEXT,
  model TEXT,
  status TEXT NOT NULL,
  error TEXT,
  ms INTEGER,
  in_tokens INTEGER,
  out_tokens INTEGER,
  image_bytes INTEGER,
  raw TEXT,
  parsed TEXT,
  final TEXT,
  created_at INTEGER NOT NULL,
  corrected_at INTEGER
);
CREATE INDEX IF NOT EXISTS scans_user_created ON scans(user_id, created_at);
CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
INSERT OR IGNORE INTO meta (k, v) VALUES ('schema', '1');
