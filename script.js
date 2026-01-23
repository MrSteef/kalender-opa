// Client ID and API key are taken from config.js
const CLIENT_ID = CONFIG.CLIENT_ID;
const API_KEY = CONFIG.API_KEY;

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC =
  "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
const SCOPES = "https://www.googleapis.com/auth/calendar.readonly";

let tokenClient;
let gapiInited = false;
let gisInited = false;

document.getElementById("authorize_button").style.visibility = "hidden";
document.getElementById("signout_button").style.visibility = "hidden";

/**
 * Callback after api.js is loaded.
 */
function gapiLoaded() {
  gapi.load("client", initializeGapiClient);
}

/**
 * Callback after the API client is loaded. Loads the
 * discovery doc to initialize the API.
 */
async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: [DISCOVERY_DOC],
  });
  gapiInited = true;
  maybeEnableButtons();
}

/**
 * Callback after Google Identity Services are loaded.
 */
function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: "", // defined later
  });
  gisInited = true;
  maybeEnableButtons();
}

/**
 * Enables user interaction after all libraries are loaded.
 */
function maybeEnableButtons() {
  if (gapiInited && gisInited) {
    document.getElementById("authorize_button").style.visibility = "visible";
  }
}

/**
 *  Sign in the user upon button click.
 */
function handleAuthClick() {
  tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) {
      throw resp;
    }
    document.getElementById("signout_button").style.visibility = "visible";
    document.getElementById("authorize_button").innerText = "Refresh";
    await listUpcomingEvents();
  };

  if (gapi.client.getToken() === null) {
    // Prompt the user to select a Google Account and ask for consent to share their data
    // when establishing a new session.
    tokenClient.requestAccessToken({ prompt: "consent" });
  } else {
    // Skip display of account chooser and consent dialog for an existing session.
    tokenClient.requestAccessToken({ prompt: "" });
  }
}

/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick() {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken("");
    document.getElementById("content").innerText = "";
    document.getElementById("authorize_button").innerText = "Authorize";
    document.getElementById("signout_button").style.visibility = "hidden";
  }
}

async function listUpcomingEvents() {
  try {
    const response = await gapi.client.calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      showDeleted: false,
      singleEvents: true,
      maxResults: 15,
      orderBy: "startTime",
    });

    const events = response.result.items || [];
    const { allDay, timed } = splitEvents(events);

    renderAllDayEvents(allDay);
    renderTimedEvents(timed);
  } catch (err) {
    console.error("Calendar Error:", err);
  }
}

function splitEvents(events) {
  return {
    allDay: events.filter((e) => e.start.date && !e.start.dateTime),
    timed: events.filter((e) => e.start.dateTime),
  };
}

function renderAllDayEvents(events) {
  const container = document.getElementById("daily-content");
  const template = document.getElementById("all-day-template");
  container.innerHTML = ""; // Clear previous

  events.forEach((event) => {
    const clone = template.content.cloneNode(true);
    clone.querySelector(".event-title").innerText = event.summary;
    container.appendChild(clone);
  });
}

function renderTimedEvents(events) {
  const container = document.getElementById("event-content");
  const template = document.getElementById("timed-template");
  container.innerHTML = ""; // Clear previous

  events.forEach((event) => {
    const clone = template.content.cloneNode(true);

    // Format times to HH:mm
    const start = new Date(event.start.dateTime).toLocaleTimeString("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const end = new Date(event.end.dateTime).toLocaleTimeString("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
    });

    clone.querySelector(".event-title").innerText = event.summary;
    clone.querySelector(".event-time").innerText = `${start} - ${end}`;

    container.appendChild(clone);
  });
}

function moveHand(id, degrees) {
  const hand = document.getElementById(id);
  if (!hand) return;

  const targetDeg = degrees === 0 ? 360 : degrees;

  hand.setAttribute(
    "transition",
    "transform 0.25s cubic-bezier(0.4, 2.08, 0.55, 0.44)",
  );
  hand.setAttribute("transform", `rotate(${targetDeg} 50 50)`);

  if (degrees === 0) {
    setTimeout(() => {
      hand.setAttribute("transition", "none");
      hand.setAttribute("transform", "rotate(0)");
    }, 300);
  }
}

function updateDigitalInfo(now) {
  const timeOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  const dayOptions = { weekday: "long" };
  const dateOptions = { day: "numeric", month: "long", year: "numeric" };

  document.getElementById("digital-clock").innerText = now.toLocaleTimeString(
    "nl-NL",
    timeOptions,
  );

  const dayName = now.toLocaleDateString("nl-NL", dayOptions);
  document.getElementById("weekday").innerText =
    dayName.charAt(0).toUpperCase() + dayName.slice(1);

  document.getElementById("date").innerText = now.toLocaleDateString(
    "nl-NL",
    dateOptions,
  );
}

function updateClock() {
  const now = new Date();

  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours();

  const secDeg = seconds * 6;
  const minDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = (hours % 12) * 30 + minutes * 0.5;

  moveHand("second-hand", secDeg);
  moveHand("minute-hand", minDeg);
  moveHand("hour-hand", hourDeg);

  updateDigitalInfo(now);
}

setInterval(updateClock, 1000);
updateClock();
