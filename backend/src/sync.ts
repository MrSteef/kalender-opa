import { calendar_v3, google } from "googleapis";
import { KeyValueStore } from "./db";
import { createAuthorizedOAuthClient } from "./google";
import {
  AppConfig,
  DisplayAllDayEvent,
  DisplayCache,
  DisplayTimedEvent,
  StoredTokens,
  SyncMeta
} from "./types";

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function relativeWords(locale: string) {
  return locale.toLowerCase().startsWith("nl")
    ? { today: "Vandaag", tomorrow: "Morgen", yesterday: "Gisteren" }
    : { today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday" };
}

function titleOrFallback(summary: string | null | undefined): string {
  return summary?.trim() || "(No title)";
}

function formatRelativeDay(date: Date, now: Date, locale: string, timeZone: string): string {
  const dayValue = getDateKey(date, timeZone);
  const todayValue = getDateKey(now, timeZone);
  const tomorrowValue = getDateKey(addDays(now, 1), timeZone);
  const yesterdayValue = getDateKey(addDays(now, -1), timeZone);
  const words = relativeWords(locale);

  if (dayValue === todayValue) {
    return words.today;
  }

  if (dayValue === tomorrowValue) {
    return words.tomorrow;
  }

  if (dayValue === yesterdayValue) {
    return words.yesterday;
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

function formatRelativeDateString(
  dateString: string,
  today: string,
  tomorrow: string,
  yesterday: string,
  locale: string
): string {
  const words = relativeWords(locale);

  if (dateString === today) {
    return words.today;
  }

  if (dateString === tomorrow) {
    return words.tomorrow;
  }

  if (dateString === yesterday) {
    return words.yesterday;
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(new Date(`${dateString}T00:00:00Z`));
}

function formatTimeLabel(start: Date, end: Date, locale: string, timeZone: string): string {
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit"
  });

  return `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
}

function normalizeTimedEvent(
  event: calendar_v3.Schema$Event,
  now: Date,
  config: AppConfig
): DisplayTimedEvent | null {
  const startIso = event.start?.dateTime;
  const endIso = event.end?.dateTime;

  if (!startIso || !endIso) {
    return null;
  }

  const start = new Date(startIso);
  const end = new Date(endIso);
  const dayLabel = formatRelativeDay(start, now, config.displayLocale, config.displayTimeZone);

  return {
    id: event.id || `${startIso}-${event.summary || "untitled"}`,
    title: titleOrFallback(event.summary),
    startIso,
    endIso,
    dayKey: getDateKey(start, config.displayTimeZone),
    dayLabel,
    timeLabel: formatTimeLabel(start, end, config.displayLocale, config.displayTimeZone),
    location: event.location?.trim() || undefined,
    isOngoing: now >= start && now < end
  };
}

function formatAllDayDateLabel(
  startDate: string,
  endDateExclusive: string,
  now: Date,
  timeZone: string,
  locale: string
): { label: string; spansMultipleDays: boolean } {
  const today = getDateKey(now, timeZone);
  const tomorrow = getDateKey(addDays(now, 1), timeZone);
  const yesterday = getDateKey(addDays(now, -1), timeZone);

  const endInclusive = addDays(new Date(`${endDateExclusive}T00:00:00Z`), -1);
  const endInclusiveDate = getDateKey(endInclusive, "UTC");
  const spansMultipleDays = startDate !== endInclusiveDate;

  const startLabel = formatRelativeDateString(startDate, today, tomorrow, yesterday, locale);
  if (!spansMultipleDays) {
    return {
      label: startLabel,
      spansMultipleDays: false
    };
  }

  const endLabel = formatRelativeDateString(endInclusiveDate, today, tomorrow, yesterday, locale);
  return {
    label: `${startLabel} – ${endLabel}`,
    spansMultipleDays: true
  };
}

function normalizeAllDayEvent(
  event: calendar_v3.Schema$Event,
  now: Date,
  config: AppConfig
): DisplayAllDayEvent | null {
  const startDate = event.start?.date;
  const endDateExclusive = event.end?.date;

  if (!startDate || !endDateExclusive) {
    return null;
  }

  const { label, spansMultipleDays } = formatAllDayDateLabel(
    startDate,
    endDateExclusive,
    now,
    config.displayTimeZone,
    config.displayLocale
  );

  return {
    id: event.id || `${startDate}-${event.summary || "untitled"}`,
    title: titleOrFallback(event.summary),
    dateLabel: label,
    startDate,
    endDateExclusive,
    location: event.location?.trim() || undefined,
    spansMultipleDays
  };
}

function createEmptyDisplayCache(config: AppConfig, meta?: SyncMeta | null): DisplayCache {
  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    lastSyncedAt: meta?.lastSyncAt ?? null,
    lastSyncError: meta?.lastSyncError ?? null,
    timeZone: config.displayTimeZone,
    locale: config.displayLocale,
    windowStart: new Date().toISOString(),
    windowEnd: new Date().toISOString(),
    timedEvents: [],
    allDayEvents: []
  };
}

async function fetchEvents(config: AppConfig, tokens: StoredTokens) {
  const auth = createAuthorizedOAuthClient(config, tokens);
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const windowStartDate = new Date(now.getTime() - config.displayDaysPast * msPerDay);
  const windowEndDate = new Date(now.getTime() + (config.displayDaysFuture + 1) * msPerDay);

  const items: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId: config.googleCalendarId,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: windowStartDate.toISOString(),
      timeMax: windowEndDate.toISOString(),
      timeZone: config.displayTimeZone,
      maxResults: 2500,
      showDeleted: false,
      pageToken
    });

    items.push(...(response.data.items || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return {
    items,
    windowStartIso: windowStartDate.toISOString(),
    windowEndIso: windowEndDate.toISOString()
  };
}

export function loadDisplayCache(store: KeyValueStore, config: AppConfig, sessionId: string): DisplayCache {
  const cached = store.loadDisplayCache(sessionId);
  const meta = store.loadSyncMeta(sessionId) ?? {
    lastSyncAt: null,
    lastSyncError: null
  };

  if (cached) {
    return {
      ...cached,
      lastSyncedAt: meta.lastSyncAt,
      lastSyncError: meta.lastSyncError
    };
  }

  return createEmptyDisplayCache(config, meta);
}

export function readTokens(store: KeyValueStore, sessionId: string): StoredTokens | null {
  return store.readTokens(sessionId);
}

export function saveTokens(store: KeyValueStore, sessionId: string, tokens: StoredTokens): void {
  store.saveTokens(sessionId, tokens);
}

export function clearTokens(store: KeyValueStore, sessionId: string): void {
  store.clearTokens(sessionId);
}

export function clearDisplayCache(store: KeyValueStore, sessionId: string): void {
  store.clearDisplayCache(sessionId);
  store.saveSyncMeta(sessionId, {
    lastSyncAt: null,
    lastSyncError: null
  } satisfies SyncMeta);
}

const syncInFlight = new Map<string, Promise<void>>();

export async function syncCalendarNow(
  store: KeyValueStore,
  config: AppConfig,
  sessionId: string
): Promise<void> {
  const existing = syncInFlight.get(sessionId);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const tokens = readTokens(store, sessionId);
    if (!tokens?.refreshToken) {
      store.saveDisplayCache(sessionId, createEmptyDisplayCache(config));
      store.saveSyncMeta(sessionId, {
        lastSyncAt: null,
        lastSyncError: null
      } satisfies SyncMeta);
      return;
    }

    try {
      const now = new Date();
      const { items, windowStartIso, windowEndIso } = await fetchEvents(config, tokens);

      const timedEvents = items
        .map((event) => normalizeTimedEvent(event, now, config))
        .filter((event): event is DisplayTimedEvent => event !== null)
        .slice(0, config.maxTimedEvents);

      const allDayEvents = items
        .map((event) => normalizeAllDayEvent(event, now, config))
        .filter((event): event is DisplayAllDayEvent => event !== null)
        .slice(0, config.maxAllDayEvents);

      const syncedAt = new Date().toISOString();
      const displayCache: DisplayCache = {
        connected: true,
        generatedAt: syncedAt,
        lastSyncedAt: syncedAt,
        lastSyncError: null,
        timeZone: config.displayTimeZone,
        locale: config.displayLocale,
        windowStart: windowStartIso,
        windowEnd: windowEndIso,
        timedEvents,
        allDayEvents
      };

      store.saveDisplayCache(sessionId, displayCache);
      store.saveSyncMeta(sessionId, {
        lastSyncAt: syncedAt,
        lastSyncError: null
      } satisfies SyncMeta);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      const existingDisplay = loadDisplayCache(store, config, sessionId);

      store.saveDisplayCache(sessionId, {
        ...existingDisplay,
        connected: true,
        generatedAt: new Date().toISOString()
      } satisfies DisplayCache);

      store.saveSyncMeta(sessionId, {
        lastSyncAt: existingDisplay.lastSyncedAt,
        lastSyncError: message
      } satisfies SyncMeta);

      throw error;
    }
  })();

  syncInFlight.set(sessionId, promise);

  try {
    await promise;
  } finally {
    syncInFlight.delete(sessionId);
  }
}

export async function syncAllCalendars(store: KeyValueStore, config: AppConfig): Promise<void> {
  const sessions = store.listSessionsWithTokens();

  for (const session of sessions) {
    try {
      await syncCalendarNow(store, config, session.sessionId);
    } catch (error) {
      console.error(`Sync failed for session ${session.sessionId}:`, error);
    }
  }
}
