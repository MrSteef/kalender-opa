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
  calendarName?: string;
}

export interface DisplayAllDayEvent {
  id: string;
  title: string;
  dateLabel: string;
  startDate: string;
  endDateExclusive: string;
  location?: string;
  spansMultipleDays: boolean;
  calendarName?: string;
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
  calendarSource: "selected" | "single" | "explicit";
  timeZone: string;
  locale: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncIntervalMs: number;
  appBaseUrl: string;
  sessionCookieName: string;
}
