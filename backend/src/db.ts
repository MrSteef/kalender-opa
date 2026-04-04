import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export class KeyValueStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    const absolutePath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    this.db = new Database(absolutePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getJson<T>(key: string): T | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.value) as T;
  }

  setJson(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(key, JSON.stringify(value), now);
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  close(): void {
    this.db.close();
  }
}
