export interface AppConfig {
  nodeEnv: "development" | "production";
  port: number;
  appBaseUrl: string;
  stateSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  googleCalendarId: string;
  displayTimeZone: string;
  displayLocale: string;
  displayDaysPast: number;
  displayDaysFuture: number;
  maxTimedEvents: number;
  maxAllDayEvents: number;
  syncIntervalMs: number;
  databasePath: string;
}

export interface StoredTokens {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number | null;
  scope?: string;
  tokenType?: string;
  updatedAt: string;
}

export interface SyncMeta {
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface DisplayTimedEvent {
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  dayKey: string;
  dayLabel: string;
  timeLabel: string;
  location?: string;
  isOngoing: boolean;
}

export interface DisplayAllDayEvent {
  id: string;
  title: string;
  dateLabel: string;
  startDate: string;
  endDateExclusive: string;
  location?: string;
  spansMultipleDays: boolean;
}

export interface DisplayCache {
  connected: boolean;
  generatedAt: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  timeZone: string;
  locale: string;
  windowStart: string;
  windowEnd: string;
  timedEvents: DisplayTimedEvent[];
  allDayEvents: DisplayAllDayEvent[];
}

export interface AdminStatus {
  connected: boolean;
  connectUrl: string;
  disconnectUrl: string;
  calendarId: string;
  timeZone: string;
  locale: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncIntervalMs: number;
  appBaseUrl: string;
}
