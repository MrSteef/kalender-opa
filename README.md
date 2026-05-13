# Kalender Opa

A single-repo, single-container Google Calendar display app for a tablet that stays on all day.

## What this project does

- Shows **timed events** on the right half.
- Shows **all-day events / birthdays** on the bottom-left.
- By default, merges events from the calendars that are **selected/visible** for the authenticated Google user.
- Shows an **analog clock**, **digital clock**, **weekday**, **date**, and a **Google Calendar connect button** on the top-left.
- Keeps the Google refresh token on the **server**, not in the browser.
- Uses a **separate server-side session per browser/device**, so one visitor cannot automatically see another visitor's calendar.
- Serves the frontend and backend from the **same origin**.
- Runs as a **single Docker container** in production.

## Privacy model

This version is **not** globally connected to one Google account anymore.

Instead:

- every browser/device gets its own long-lived **opaque session cookie**
- the backend stores that browser's Google refresh token under that session
- `/api/display` only returns the calendar data that belongs to the current session
- another visitor on another device starts with an empty session and must connect their own Google account

That means:

- your grandpa's tablet can stay connected to **his** calendar
- your laptop can connect to **your** calendar
- the two browsers do **not** share calendar data

By default, this build shows the calendars that are **selected/visible** in that user's Google Calendar UI. That means one viewer sees **their own selected calendars**, and another viewer sees **their own selected calendars**.

## Project structure

```text
kalender-opa/
├── .dockerignore
├── .env.development.example
├── .env.production.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── package.json
├── README.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── db.ts
│       ├── env.ts
│       ├── google.ts
│       ├── server.ts
│       ├── session.ts
│       ├── state-token.ts
│       ├── sync.ts
│       └── types.ts
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.ts
│       ├── style.css
│       └── types.ts
└── ops/
    └── nginx/
        └── kalender-opa.conf.example
```

## Architecture

- **Frontend:** Vite + TypeScript
- **Backend:** Express + TypeScript
- **Persistence:** SQLite
- **Google auth:** server-side OAuth 2.0 authorization code flow
- **Per-browser identity:** HTTP-only session cookie
- **Deployment:** one Docker image, one container
- **Reverse proxy in prod:** your existing nginx
- **Dev public URL:** `https://kalender-opa.svcode.dev`
- **Prod public URL:** `https://kalender-opa.stefanveltmaat.com`

The browser does not store the long-lived Google credential. The backend stores the refresh token in SQLite and uses it to fetch calendar data for that specific browser session.

## Google Cloud setup

You have two environments:

- **Dev**
  - domain: `kalender-opa.svcode.dev`
  - GCP project: `kalender-opa-dev`
- **Prod**
  - domain: `kalender-opa.stefanveltmaat.com`
  - GCP project: `kalender-opa`

Do the following **for each GCP project**.

### 1. Enable the Google Calendar API

In the correct Google Cloud project:

- Go to **APIs & Services**
- Open **Library**
- Enable **Google Calendar API**

### 2. Configure the OAuth consent screen

In the same project:

- Go to **APIs & Services** → **OAuth consent screen**
- Choose **External**
- Fill in the app name and contact email
- Add the app domain details
- Add the authorized domain:
  - dev project: `svcode.dev`
  - prod project: `stefanveltmaat.com`

For scopes, request:

- `https://www.googleapis.com/auth/calendar.readonly`

### 3. Publish the app

Set the OAuth consent screen publishing status to **In production** once you're ready.

### 4. Create the OAuth client

In the correct GCP project:

- Go to **APIs & Services** → **Credentials**
- Click **Create credentials**
- Choose **OAuth client ID**
- Application type: **Web application**

Use these redirect URIs:

#### Dev
- `https://kalender-opa.svcode.dev/auth/google/callback`

#### Prod
- `https://kalender-opa.stefanveltmaat.com/auth/google/callback`

Optional JavaScript origins:

#### Dev origin
- `https://kalender-opa.svcode.dev`

#### Prod origin
- `https://kalender-opa.stefanveltmaat.com`

Copy the generated **Client ID** and **Client secret** into your environment file.

## Environment configuration

### Dev example

Copy:

```bash
cp .env.development.example .env
```

Then fill in the real secrets.

Important values:

- `APP_BASE_URL=https://kalender-opa.svcode.dev`
- `GOOGLE_CLIENT_ID=<dev project web client id>`
- `GOOGLE_CLIENT_SECRET=<dev project web client secret>`
- `GOOGLE_CALENDAR_SOURCE=selected`
- `GOOGLE_CALENDAR_ID=primary`

Default behavior:

- `GOOGLE_CALENDAR_SOURCE=selected` means: fetch the calendars on the authenticated user's calendar list and include the ones that are marked as selected/visible in Google Calendar.
- `GOOGLE_CALENDAR_SOURCE=single` means: fetch exactly one calendar, usually `primary`.
- `GOOGLE_CALENDAR_SOURCE=explicit` means: fetch the comma-separated ids in `GOOGLE_CALENDAR_IDS`.

### Prod example

On your server:

```bash
cp .env.production.example .env
```

Then fill in:

- `APP_BASE_URL=https://kalender-opa.stefanveltmaat.com`
- `GOOGLE_CLIENT_ID=<prod project web client id>`
- `GOOGLE_CLIENT_SECRET=<prod project web client secret>`
- `GOOGLE_CALENDAR_SOURCE=selected`
- `GOOGLE_CALENDAR_ID=primary`

### Environment variable reference

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | app port, default `3000` |
| `APP_BASE_URL` | full public URL of the current environment |
| `STATE_SECRET` | used to sign OAuth state values |
| `SESSION_COOKIE_NAME` | name of the long-lived browser identity cookie |
| `SESSION_COOKIE_MAX_AGE_DAYS` | how long the browser identity cookie should live |
| `GOOGLE_CLIENT_ID` | OAuth client id for the current environment |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret for the current environment |
| `GOOGLE_CALENDAR_SOURCE` | `selected` (default), `single`, or `explicit` |
| `GOOGLE_CALENDAR_ID` | calendar to display when `GOOGLE_CALENDAR_SOURCE=single`; fallback value in other modes |
| `GOOGLE_CALENDAR_IDS` | comma-separated calendar ids when `GOOGLE_CALENDAR_SOURCE=explicit` |
| `DISPLAY_TIME_ZONE` | example: `Europe/Amsterdam` |
| `DISPLAY_LOCALE` | example: `nl-NL` |
| `DISPLAY_DAYS_PAST` | how many past days to include |
| `DISPLAY_DAYS_FUTURE` | how many future days to include |
| `MAX_TIMED_EVENTS` | hard cap for timed event list |
| `MAX_ALL_DAY_EVENTS` | hard cap for all-day list |
| `SYNC_INTERVAL_MS` | backend sync interval |
| `DATABASE_PATH` | SQLite file path |
| `VITE_ALLOWED_HOSTS` | comma-separated hostnames Vite should accept in dev / preview mode |

## Local development on your laptop

This project supports same-origin local dev.

### 1. Prepare the environment

```bash
cp .env.development.example .env
npm install
```

Fill in the real dev GCP credentials. If you use a tunnel hostname, keep that hostname in `VITE_ALLOWED_HOSTS`.

### 2. Run the app

```bash
npm run dev
```

The app listens on port `3000` by default.

### 3. Point your Cloudflare tunnel at it

Your dev domain already exists:

- `kalender-opa.svcode.dev`

Configure the tunnel so requests to that hostname go to:

- `http://localhost:3000`

The Express app serves both the frontend and the backend on that one origin.

### 4. Connect a browser to Google Calendar

Open:

- `https://kalender-opa.svcode.dev`

Click **Deze browser koppelen**.

That stores the refresh token in your SQLite database file **for that browser session only**. After connecting, the backend will read the calendars that are selected/visible for that Google account and merge their events into the display. If you already had the app running with `GOOGLE_CALENDAR_ID=primary`, just restart the server and trigger **Nu synchroniseren** once.

If you open the same app in another browser or on another device, it will start disconnected and can connect a different Google account.

## Production deployment on your home server

### 1. Prepare the env file

Copy the production example:

```bash
cp .env.production.example .env
```

Fill in the real production values.

### 2. Build and run with Docker Compose

```bash
docker compose up -d --build
```

This creates:

- one app container
- one named Docker volume for `/data`

The SQLite database lives in that volume.

### 3. Put nginx in front of it

Use the example in:

- `ops/nginx/kalender-opa.conf.example`

Point nginx at:

- `http://127.0.0.1:3000`

### 4. Open the site on the tablet

Open:

- `https://kalender-opa.stefanveltmaat.com`

Then click **Deze browser koppelen** once and log in with your grandpa's Google account.

After that, the tablet keeps presenting its session cookie and the backend keeps using that session's refresh token.

## How the session model works

### Session lifecycle

- first visit: backend creates a random session id
- browser stores it in an **HTTP-only cookie**
- when the user connects Google, the refresh token is stored under that session id
- every later API request uses the same cookie
- the backend returns only that session's cached calendar data

### What happens if cookies are cleared?

If the browser's cookies are cleared, that browser loses its identity and becomes a new viewer. It will need to connect Google again.

That is expected.

### What happens if another person visits the URL?

They get their **own** empty session. They do not see the tablet's calendar unless they are using the exact same browser session cookie.

## Scripts

From the repo root:

```bash
npm install
npm run dev
npm run build
npm run start
npm run check
```

## Notes

- This app is intentionally simple.
- It uses one backend process to serve both the API and the built frontend.
- The backend periodically syncs all connected viewer sessions it knows about.
- The display page itself never talks to Google directly.
