import dotenv from "dotenv";
import path from "node:path";
import { AppConfig } from "./types";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadConfig(): AppConfig {
  const nodeEnv = optional("NODE_ENV", "development");
  if (nodeEnv !== "development" && nodeEnv !== "production") {
    throw new Error(`NODE_ENV must be "development" or "production"`);
  }

  return {
    nodeEnv,
    port: integer("PORT", 3000),
    appBaseUrl: normalizeBaseUrl(required("APP_BASE_URL")),
    stateSecret: required("STATE_SECRET"),
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    googleCalendarId: optional("GOOGLE_CALENDAR_ID", "primary"),
    displayTimeZone: optional("DISPLAY_TIME_ZONE", "Europe/Amsterdam"),
    displayLocale: optional("DISPLAY_LOCALE", "nl-NL"),
    displayDaysPast: integer("DISPLAY_DAYS_PAST", 0),
    displayDaysFuture: integer("DISPLAY_DAYS_FUTURE", 14),
    maxTimedEvents: integer("MAX_TIMED_EVENTS", 40),
    maxAllDayEvents: integer("MAX_ALL_DAY_EVENTS", 40),
    syncIntervalMs: integer("SYNC_INTERVAL_MS", 60_000),
    databasePath: optional("DATABASE_PATH", "./data/kalender-opa.sqlite")
  };
}
