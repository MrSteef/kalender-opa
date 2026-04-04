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

const TOKENS_KEY = "oauth_tokens";
const DISPLAY_CACHE_KEY = "display_cache";
const SYNC_META_KEY = "sync_meta";

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

function formatRelativeDateString(dateString: string, today: string, tomorrow: string, yesterday: string, locale: string): string {
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

export function loadDisplayCache(store: KeyValueStore, config: AppConfig): DisplayCache {
  const cached = store.getJson<DisplayCache>(DISPLAY_CACHE_KEY);
  const meta = store.getJson<SyncMeta>(SYNC_META_KEY) ?? {
    lastSyncAt: null,
    lastSyncError: null
  };

  if (cached) {
    return {
      ...cached,
      lastSyncAt: meta.lastSyncAt,
      lastSyncError: meta.lastSyncError
    };
  }

  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    lastSyncedAt: meta.lastSyncAt,
    lastSyncError: meta.lastSyncError,
    timeZone: config.displayTimeZone,
    locale: config.displayLocale,
    windowStart: new Date().toISOString(),
    windowEnd: new Date().toISOString(),
    timedEvents: [],
    allDayEvents: []
  };
}

export function readTokens(store: KeyValueStore): StoredTokens | null {
  return store.getJson<StoredTokens>(TOKENS_KEY);
}

export function saveTokens(store: KeyValueStore, tokens: StoredTokens): void {
  store.setJson(TOKENS_KEY, tokens);
}

export function clearTokens(store: KeyValueStore): void {
  store.delete(TOKENS_KEY);
}

export function clearDisplayCache(store: KeyValueStore): void {
  store.delete(DISPLAY_CACHE_KEY);
  store.setJson(SYNC_META_KEY, {
    lastSyncAt: null,
    lastSyncError: null
  } satisfies SyncMeta);
}

let syncInFlight: Promise<void> | null = null;

export async function syncCalendarNow(store: KeyValueStore, config: AppConfig): Promise<void> {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    const tokens = readTokens(store);
    if (!tokens?.refreshToken) {
      const emptyCache: DisplayCache = {
        connected: false,
        generatedAt: new Date().toISOString(),
        lastSyncedAt: null,
        lastSyncError: null,
        timeZone: config.displayTimeZone,
        locale: config.displayLocale,
        windowStart: new Date().toISOString(),
        windowEnd: new Date().toISOString(),
        timedEvents: [],
        allDayEvents: []
      };
      store.setJson(DISPLAY_CACHE_KEY, emptyCache);
      store.setJson(SYNC_META_KEY, {
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

      const displayCache: DisplayCache = {
        connected: true,
        generatedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        timeZone: config.displayTimeZone,
        locale: config.displayLocale,
        windowStart: windowStartIso,
        windowEnd: windowEndIso,
        timedEvents,
        allDayEvents
      };

      store.setJson(DISPLAY_CACHE_KEY, displayCache);
      store.setJson(SYNC_META_KEY, {
        lastSyncAt: displayCache.lastSyncedAt,
        lastSyncError: null
      } satisfies SyncMeta);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      const existing = loadDisplayCache(store, config);

      store.setJson(DISPLAY_CACHE_KEY, {
        ...existing,
        connected: true,
        generatedAt: new Date().toISOString()
      } satisfies DisplayCache);

      store.setJson(SYNC_META_KEY, {
        lastSyncAt: existing.lastSyncedAt,
        lastSyncError: message
      } satisfies SyncMeta);

      throw error;
    }
  })();

  try {
    await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}
