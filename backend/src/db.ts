import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DisplayCache, StoredTokens, SyncMeta, ViewerSessionRecord } from "./types";

interface ViewerSessionRow {
  session_id: string;
  created_at: string;
  last_seen_at: string;
  tokens_json: string | null;
  display_cache_json: string | null;
  sync_meta_json: string | null;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}

function serializeJson(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  return JSON.stringify(value);
}

function toRecord(row: ViewerSessionRow): ViewerSessionRecord {
  return {
    sessionId: row.session_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    tokens: parseJson<StoredTokens>(row.tokens_json),
    displayCache: parseJson<DisplayCache>(row.display_cache_json),
    syncMeta: parseJson<SyncMeta>(row.sync_meta_json)
  };
}

export class KeyValueStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    const absolutePath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    this.db = new Database(absolutePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS viewer_sessions (
        session_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        tokens_json TEXT,
        display_cache_json TEXT,
        sync_meta_json TEXT
      );
    `);
  }

  ensureSession(sessionId: string): ViewerSessionRecord {
    const existing = this.getSession(sessionId);
    if (existing) {
      this.touchSession(sessionId);
      return this.getSession(sessionId)!;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO viewer_sessions (
          session_id,
          created_at,
          last_seen_at,
          tokens_json,
          display_cache_json,
          sync_meta_json
        ) VALUES (?, ?, ?, NULL, NULL, NULL)
      `)
      .run(sessionId, now, now);

    return this.getSession(sessionId)!;
  }

  getSession(sessionId: string): ViewerSessionRecord | null {
    const row = this.db
      .prepare(`
        SELECT session_id, created_at, last_seen_at, tokens_json, display_cache_json, sync_meta_json
        FROM viewer_sessions
        WHERE session_id = ?
      `)
      .get(sessionId) as ViewerSessionRow | undefined;

    if (!row) {
      return null;
    }

    return toRecord(row);
  }

  touchSession(sessionId: string): void {
    this.db
      .prepare("UPDATE viewer_sessions SET last_seen_at = ? WHERE session_id = ?")
      .run(new Date().toISOString(), sessionId);
  }

  saveTokens(sessionId: string, tokens: StoredTokens): void {
    this.ensureSession(sessionId);
    this.db
      .prepare("UPDATE viewer_sessions SET tokens_json = ?, last_seen_at = ? WHERE session_id = ?")
      .run(serializeJson(tokens), new Date().toISOString(), sessionId);
  }

  readTokens(sessionId: string): StoredTokens | null {
    return this.getSession(sessionId)?.tokens ?? null;
  }

  clearTokens(sessionId: string): void {
    this.ensureSession(sessionId);
    this.db
      .prepare("UPDATE viewer_sessions SET tokens_json = NULL, last_seen_at = ? WHERE session_id = ?")
      .run(new Date().toISOString(), sessionId);
  }

  saveDisplayCache(sessionId: string, cache: DisplayCache): void {
    this.ensureSession(sessionId);
    this.db
      .prepare("UPDATE viewer_sessions SET display_cache_json = ?, last_seen_at = ? WHERE session_id = ?")
      .run(serializeJson(cache), new Date().toISOString(), sessionId);
  }

  loadDisplayCache(sessionId: string): DisplayCache | null {
    return this.getSession(sessionId)?.displayCache ?? null;
  }

  clearDisplayCache(sessionId: string): void {
    this.ensureSession(sessionId);
    this.db
      .prepare("UPDATE viewer_sessions SET display_cache_json = NULL, last_seen_at = ? WHERE session_id = ?")
      .run(new Date().toISOString(), sessionId);
  }

  saveSyncMeta(sessionId: string, meta: SyncMeta): void {
    this.ensureSession(sessionId);
    this.db
      .prepare("UPDATE viewer_sessions SET sync_meta_json = ?, last_seen_at = ? WHERE session_id = ?")
      .run(serializeJson(meta), new Date().toISOString(), sessionId);
  }

  loadSyncMeta(sessionId: string): SyncMeta | null {
    return this.getSession(sessionId)?.syncMeta ?? null;
  }

  listSessionsWithTokens(): Array<{ sessionId: string; tokens: StoredTokens }> {
    const rows = this.db
      .prepare(`
        SELECT session_id, tokens_json
        FROM viewer_sessions
        WHERE tokens_json IS NOT NULL
      `)
      .all() as Array<{ session_id: string; tokens_json: string | null }>;

    return rows.flatMap((row) => {
      const tokens = parseJson<StoredTokens>(row.tokens_json);
      if (!tokens?.refreshToken) {
        return [];
      }

      return [{ sessionId: row.session_id, tokens }];
    });
  }

  close(): void {
    this.db.close();
  }
}
