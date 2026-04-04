import "./style.css";
import { AdminStatus, DisplayAllDayEvent, DisplayCache, DisplayTimedEvent } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

let displayData: DisplayCache | null = null;
let adminStatus: AdminStatus | null = null;

const state = {
  now: new Date(),
  disconnectBusy: false,
  resyncBusy: false
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatClock(now: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(now);
}

function formatWeekday(now: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long"
  }).format(now);
}

function formatDate(now: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(now);
}

function formatLastSync(iso: string | null, locale: string, timeZone: string): string {
  if (!iso) {
    return "Nog niet gesynchroniseerd";
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function groupTimedEvents(events: DisplayTimedEvent[]) {
  const groups = new Map<string, { label: string; items: DisplayTimedEvent[] }>();

  for (const event of events) {
    const group = groups.get(event.dayKey);
    if (group) {
      group.items.push(event);
      continue;
    }

    groups.set(event.dayKey, {
      label: event.dayLabel,
      items: [event]
    });
  }

  return Array.from(groups.entries()).map(([dayKey, value]) => ({
    dayKey,
    dayLabel: value.label,
    items: value.items
  }));
}

function renderTimedEvents(events: DisplayTimedEvent[]): string {
  if (!events.length) {
    return `<div class="empty-state">Geen afspraken met tijd in de gekozen periode.</div>`;
  }

  return groupTimedEvents(events)
    .map(
      (group) => `
        <section class="day-group">
          <h3 class="day-heading">${escapeHtml(group.dayLabel)}</h3>
          ${group.items
            .map(
              (event) => `
                <article class="event-card timed">
                  <div class="event-time">${escapeHtml(event.timeLabel)}</div>
                  <div class="event-main">
                    <div class="event-title">${escapeHtml(event.title)}</div>
                    ${
                      event.location
                        ? `<div class="event-location">${escapeHtml(event.location)}</div>`
                        : ""
                    }
                    ${event.isOngoing ? `<div class="event-live">Nu bezig</div>` : ""}
                  </div>
                </article>
              `
            )
            .join("")}
        </section>
      `
    )
    .join("");
}

function renderAllDayEvents(events: DisplayAllDayEvent[]): string {
  if (!events.length) {
    return `<div class="empty-state">Geen hele-dag afspraken of verjaardagen in de gekozen periode.</div>`;
  }

  return events
    .map(
      (event) => `
        <article class="event-card all-day">
          <div class="event-date">${escapeHtml(event.dateLabel)}</div>
          <div class="event-main">
            <div class="event-title">${escapeHtml(event.title)}</div>
            ${
              event.location
                ? `<div class="event-location">${escapeHtml(event.location)}</div>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");
}

function render() {
  const locale = displayData?.locale || adminStatus?.locale || "nl-NL";
  const timeZone = displayData?.timeZone || adminStatus?.timeZone || "Europe/Amsterdam";
  const connectUrl = adminStatus?.connectUrl || "/auth/google/start";
  const disconnectLabel = state.disconnectBusy ? "Bezig…" : "Ontkoppelen";
  const lastSyncText = formatLastSync(displayData?.lastSyncedAt || adminStatus?.lastSyncAt || null, locale, timeZone);

  app!.innerHTML = `
    <main class="app-shell">
      <section class="panel panel-top-left">
        <div class="panel-header">
          <div>
            <h1 class="panel-title">Kalender</h1>
            <p class="panel-subtitle">Rustige overzichtspagina voor op de tablet</p>
          </div>
          <div class="status-badges">
            <span class="badge ${adminStatus?.connected ? "connected" : "disconnected"}">
              ${adminStatus?.connected ? "Google Kalender verbonden voor deze browser" : "Deze browser is niet verbonden"}
            </span>
            ${
              displayData?.lastSyncError
                ? `<span class="badge error">Synchronisatie fout</span>`
                : ""
            }
          </div>
        </div>

        <div class="clock-grid">
          <div class="analog-wrap">
            <canvas id="analog-clock" width="300" height="300" aria-label="Analog clock"></canvas>
          </div>
          <div class="time-block">
            <div class="digital-clock">${escapeHtml(formatClock(state.now, locale, timeZone))}</div>
            <div class="weekday">${escapeHtml(capitalize(formatWeekday(state.now, locale, timeZone)))}</div>
            <div class="date-line">${escapeHtml(capitalize(formatDate(state.now, locale, timeZone)))}</div>
          </div>
        </div>

        <div class="control-row">
          <a class="primary-button" href="${escapeHtml(connectUrl)}">
            ${adminStatus?.connected ? "Deze browser opnieuw koppelen" : "Deze browser koppelen"}
          </a>
          ${
            adminStatus?.connected
              ? `<button id="disconnect-button" class="secondary-button" type="button">${escapeHtml(disconnectLabel)}</button>
                 <button id="resync-button" class="secondary-button" type="button">${state.resyncBusy ? "Bezig…" : "Nu synchroniseren"}</button>`
              : ""
          }
        </div>

        ${
          displayData?.lastSyncError
            ? `<div class="banner">Laatste synchronisatie mislukte: ${escapeHtml(displayData.lastSyncError)}</div>`
            : ""
        }

        <div class="meta-note">
          Kalender voor deze browser: <strong>${escapeHtml(adminStatus?.calendarId || "primary")}</strong><br />
          Laatste succesvolle synchronisatie: <strong>${escapeHtml(lastSyncText)}</strong>
        </div>
      </section>

      <section class="panel panel-bottom-left">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Hele dag</h2>
            <p class="panel-subtitle">Verjaardagen en afspraken zonder tijd</p>
          </div>
        </div>
        <div class="section-list">
          ${renderAllDayEvents(displayData?.allDayEvents || [])}
        </div>
      </section>

      <section class="panel panel-right">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Afspraken met tijd</h2>
            <p class="panel-subtitle">Komende afspraken binnen het ingestelde venster</p>
          </div>
        </div>
        <div class="section-list">
          ${renderTimedEvents(displayData?.timedEvents || [])}
        </div>
        <div class="footer-note">
          Laatste update in de browser: ${escapeHtml(formatClock(state.now, locale, timeZone))}
        </div>
      </section>
    </main>
  `;

  attachButtonHandlers();
  drawAnalogClock(state.now, timeZone);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function drawAnalogClock(now: Date, timeZone: string) {
  const canvas = document.querySelector<HTMLCanvasElement>("#analog-clock");
  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  const second = Number(parts.find((part) => part.type === "second")?.value || "0");

  const size = canvas.width;
  const radius = size / 2;

  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(radius, radius);

  context.fillStyle = "#0f172a";
  context.beginPath();
  context.arc(0, 0, radius - 4, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(148, 163, 184, 0.28)";
  context.lineWidth = 6;
  context.beginPath();
  context.arc(0, 0, radius - 8, 0, Math.PI * 2);
  context.stroke();

  for (let index = 0; index < 60; index += 1) {
    const angle = (Math.PI / 30) * index;
    const isHourMark = index % 5 === 0;
    const outer = radius - 20;
    const inner = isHourMark ? radius - 38 : radius - 28;

    context.strokeStyle = isHourMark ? "rgba(226, 232, 240, 0.75)" : "rgba(148, 163, 184, 0.35)";
    context.lineWidth = isHourMark ? 5 : 2;
    context.beginPath();
    context.moveTo(Math.cos(angle - Math.PI / 2) * inner, Math.sin(angle - Math.PI / 2) * inner);
    context.lineTo(Math.cos(angle - Math.PI / 2) * outer, Math.sin(angle - Math.PI / 2) * outer);
    context.stroke();
  }

  drawHand(context, ((hour % 12) + minute / 60) * (Math.PI / 6), radius * 0.46, 8, "#f8fafc");
  drawHand(context, (minute + second / 60) * (Math.PI / 30), radius * 0.66, 5, "#cbd5e1");
  drawHand(context, second * (Math.PI / 30), radius * 0.74, 2.5, "#f87171");

  context.fillStyle = "#f8fafc";
  context.beginPath();
  context.arc(0, 0, 7, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawHand(
  context: CanvasRenderingContext2D,
  angle: number,
  length: number,
  width: number,
  color: string
) {
  context.save();
  context.rotate(angle - Math.PI / 2);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-14, 0);
  context.lineTo(length, 0);
  context.stroke();
  context.restore();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function refreshDisplay() {
  try {
    displayData = await fetchJson<DisplayCache>("/api/display");
  } catch (error) {
    console.error("Failed to refresh display", error);
  } finally {
    render();
  }
}

async function refreshAdminStatus() {
  try {
    adminStatus = await fetchJson<AdminStatus>("/api/admin/status");
  } catch (error) {
    console.error("Failed to refresh admin status", error);
  } finally {
    render();
  }
}

async function disconnectCalendar() {
  if (state.disconnectBusy) {
    return;
  }

  const confirmed = window.confirm("Google Kalender ontkoppelen?");
  if (!confirmed) {
    return;
  }

  state.disconnectBusy = true;
  render();

  try {
    const response = await fetch("/auth/google/disconnect", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("Disconnect failed");
    }

    await Promise.all([refreshAdminStatus(), refreshDisplay()]);
  } catch (error) {
    console.error(error);
    window.alert("Ontkoppelen mislukte.");
  } finally {
    state.disconnectBusy = false;
    render();
  }
}

async function resyncCalendar() {
  if (state.resyncBusy) {
    return;
  }

  state.resyncBusy = true;
  render();

  try {
    const response = await fetch("/api/admin/resync", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("Resync failed");
    }

    await Promise.all([refreshAdminStatus(), refreshDisplay()]);
  } catch (error) {
    console.error(error);
    window.alert("Synchroniseren mislukte.");
  } finally {
    state.resyncBusy = false;
    render();
  }
}

function attachButtonHandlers() {
  document.querySelector<HTMLButtonElement>("#disconnect-button")?.addEventListener("click", () => {
    void disconnectCalendar();
  });

  document.querySelector<HTMLButtonElement>("#resync-button")?.addEventListener("click", () => {
    void resyncCalendar();
  });
}

async function bootstrap() {
  await Promise.all([refreshAdminStatus(), refreshDisplay()]);
  render();

  window.setInterval(() => {
    state.now = new Date();
    render();
  }, 1000);

  window.setInterval(() => {
    void refreshDisplay();
  }, 30_000);

  window.setInterval(() => {
    void refreshAdminStatus();
  }, 60_000);
}

void bootstrap();
