# Kalender Opa

A single-repo, single-container Google Calendar display app for a tablet that stays on all day.

## What this project does

- Shows **timed events** on the right half.
- Shows **all-day events / birthdays** on the bottom-left.
- Shows an **analog clock**, **digital clock**, **weekday**, **date**, and a **Google Calendar connect button** on the top-left.
- Keeps the Google refresh token on the **server**, not in the tablet browser.
- Serves the frontend and backend from the **same origin**.
- Runs as a **single Docker container** in production.

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
- **Deployment:** one Docker image, one container
- **Reverse proxy in prod:** your existing nginx
- **Dev public URL:** `https://kalender-opa.svcode.dev`
- **Prod public URL:** `https://kalender-opa.stefanveltmaat.com`

The browser never stores the long-lived Google credential. The backend stores the refresh token in SQLite and uses it to fetch calendar data.

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

For scopes, only request:

- `https://www.googleapis.com/auth/calendar.readonly`

That keeps the app read-only.

### 3. Publish the app

Set the OAuth consent screen publishing status to **In production** once you're ready.

Why this matters: Google testing mode is the classic reason refresh tokens die after 7 days. For the tablet setup you want, do not leave the app in Testing.

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

You can also add these JavaScript origins if you want the console entry to be complete:

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

### Prod example

On your server:

```bash
cp .env.production.example .env
```

Then fill in:

- `APP_BASE_URL=https://kalender-opa.stefanveltmaat.com`
- `GOOGLE_CLIENT_ID=<prod project web client id>`
- `GOOGLE_CLIENT_SECRET=<prod project web client secret>`

### Environment variable reference

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | app port, default `3000` |
| `APP_BASE_URL` | full public URL of the current environment |
| `STATE_SECRET` | used to sign OAuth state values |
| `GOOGLE_CLIENT_ID` | OAuth client id for the current environment |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret for the current environment |
| `GOOGLE_CALENDAR_ID` | calendar to display, usually `primary` |
| `DISPLAY_TIME_ZONE` | example: `Europe/Amsterdam` |
| `DISPLAY_LOCALE` | example: `nl-NL` |
| `DISPLAY_DAYS_PAST` | how many past days to include |
| `DISPLAY_DAYS_FUTURE` | how many future days to include |
| `MAX_TIMED_EVENTS` | hard cap for timed event list |
| `MAX_ALL_DAY_EVENTS` | hard cap for all-day list |
| `SYNC_INTERVAL_MS` | backend sync interval |
| `DATABASE_PATH` | SQLite file path |

## Local development on your laptop

This project supports same-origin local dev.

### 1. Prepare the environment

```bash
cp .env.development.example .env
npm install
```

Fill in the real dev GCP credentials.

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

The Express app will serve both the frontend and the backend on that one origin.

### 4. Connect Google Calendar once

Open:

- `https://kalender-opa.svcode.dev`

Click **Google Kalender koppelen**.

That stores the refresh token in your SQLite database file and the server starts syncing calendar data.

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

The app itself already serves both frontend and backend, so nginx only needs to reverse proxy the domain to the container port.

### 4. Open the production URL and connect once

Open:

- `https://kalender-opa.stefanveltmaat.com`

Click **Google Kalender koppelen** once.

After that, the server keeps using the stored refresh token.

## Useful commands

### Dev
```bash
npm run dev
```

### Type-check
```bash
npm run check
```

### Production build
```bash
npm run build
```

### Start built app without Docker
```bash
npm start
```

## Backend routes

### Public API
- `GET /api/health`
- `GET /api/display`
- `GET /api/admin/status`
- `POST /api/admin/resync`

### OAuth
- `GET /auth/google/start`
- `GET /auth/google/callback`
- `POST /auth/google/disconnect`

## Notes and tradeoffs

### Why one container?
Because this app is small, same-origin, and family-operated. One image is easier to deploy and easier to debug.

### Why not GitHub Pages?
Because same-origin plus server-side token storage is simpler and more reliable for this use case.

### Why not browser-side Google tokens?
Because you do not want the tablet browser to be the thing that carries the long-lived auth state.

### Why SQLite?
Because this app only needs a small amount of persistent state:
- refresh token
- cached display payload
- sync metadata

SQLite is more than enough.

### Why a full windowed sync instead of a more complex sync-token implementation?
Because for a single household display app, a periodic read-only fetch over a limited date window is simpler and easier to maintain. If you ever need to optimize later, you can add Calendar incremental sync then.

## First things to test

1. `GET /api/health` returns OK.
2. `GET /api/admin/status` shows disconnected before Google auth.
3. Clicking the connect button completes OAuth and redirects back to `/`.
4. `GET /api/display` starts returning real events.
5. Restarting the container still shows the calendar without reconnecting.
6. Refreshing the tablet page does not require logging in again.

## Likely future improvements

- hidden admin mode so the connect/disconnect buttons are less visible
- full-screen kiosk mode recommendations for the tablet
- separate calendar selection UI
- birthday highlighting
- larger-font display mode for weaker eyesight
- retry/backoff around sync failures
