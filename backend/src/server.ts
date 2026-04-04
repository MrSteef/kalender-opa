import "dotenv/config";
import express, { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./env";
import { KeyValueStore } from "./db";
import { createOAuthClient } from "./google";
import { createStateToken, verifyStateToken } from "./state-token";
import { clearDisplayCache, clearTokens, loadDisplayCache, readTokens, saveTokens, syncAllCalendars, syncCalendarNow } from "./sync";
import { AdminStatus, StoredTokens } from "./types";
import { ensureViewerSession, setSessionCookie } from "./session";

async function start() {
  const config = loadConfig();
  const store = new KeyValueStore(config.databasePath);
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json());

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });

  const projectRoot = path.resolve(__dirname, "../..");
  const frontendRoot = path.resolve(projectRoot, "frontend");

  app.get("/api/health", (req, res) => {
    const sessionId = ensureViewerSession(req, res, store, config);
    res.json({
      ok: true,
      env: config.nodeEnv,
      time: new Date().toISOString(),
      sessionCookieName: config.sessionCookieName,
      hasSession: Boolean(sessionId)
    });
  });

  app.get("/api/display", async (req, res) => {
    const sessionId = ensureViewerSession(req, res, store, config);
    res.setHeader("Cache-Control", "no-store");

    const tokens = readTokens(store, sessionId);
    if (tokens && !loadDisplayCache(store, config, sessionId).lastSyncedAt) {
      try {
        await syncCalendarNow(store, config, sessionId);
      } catch {
        // Keep serving the cached version if sync fails.
      }
    }

    res.json(loadDisplayCache(store, config, sessionId));
  });

  app.get("/api/admin/status", (req, res) => {
    const sessionId = ensureViewerSession(req, res, store, config);
    res.setHeader("Cache-Control", "no-store");
    const tokens = readTokens(store, sessionId);
    const display = loadDisplayCache(store, config, sessionId);

    const status: AdminStatus = {
      connected: Boolean(tokens?.refreshToken),
      connectUrl: "/auth/google/start",
      disconnectUrl: "/auth/google/disconnect",
      calendarId: config.googleCalendarId,
      timeZone: config.displayTimeZone,
      locale: config.displayLocale,
      lastSyncAt: display.lastSyncedAt,
      lastSyncError: display.lastSyncError,
      syncIntervalMs: config.syncIntervalMs,
      appBaseUrl: config.appBaseUrl,
      sessionCookieName: config.sessionCookieName
    };

    res.json(status);
  });

  app.post("/api/admin/resync", async (req, res) => {
    const sessionId = ensureViewerSession(req, res, store, config);

    try {
      await syncCalendarNow(store, config, sessionId);
      res.json({
        ok: true,
        display: loadDisplayCache(store, config, sessionId)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown resync error";
      res.status(500).json({
        ok: false,
        error: message
      });
    }
  });

  app.get("/auth/google/start", (req, res) => {
    const sessionId = ensureViewerSession(req, res, store, config);
    const state = createStateToken(config.stateSecret, sessionId);
    const oauthClient = createOAuthClient(config);

    const authUrl = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: ["https://www.googleapis.com/auth/calendar.readonly"],
      state
    });

    res.redirect(authUrl);
  });

  app.get("/auth/google/callback", async (req: Request, res: Response) => {
    const state = String(req.query.state || "");
    const code = String(req.query.code || "");
    const statePayload = verifyStateToken(state, config.stateSecret);

    if (!statePayload) {
      res.status(400).send("Invalid or expired OAuth state.");
      return;
    }

    if (!code) {
      res.status(400).send("Missing authorization code.");
      return;
    }

    try {
      store.ensureSession(statePayload.sessionId);
      const oauthClient = createOAuthClient(config);
      const { tokens } = await oauthClient.getToken(code);

      const existing = readTokens(store, statePayload.sessionId);
      const refreshToken = tokens.refresh_token || existing?.refreshToken;
      if (!refreshToken) {
        res.status(400).send("Google did not return a refresh token. Try connecting again.");
        return;
      }

      const storedTokens: StoredTokens = {
        refreshToken,
        accessToken: tokens.access_token || existing?.accessToken,
        expiryDate: tokens.expiry_date ?? existing?.expiryDate ?? null,
        scope: tokens.scope || existing?.scope,
        tokenType: tokens.token_type || existing?.tokenType,
        updatedAt: new Date().toISOString()
      };

      saveTokens(store, statePayload.sessionId, storedTokens);
      setSessionCookie(req, res, config, statePayload.sessionId);
      await syncCalendarNow(store, config, statePayload.sessionId);

      res.redirect("/");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown OAuth error";
      res.status(500).send(`Failed to connect Google Calendar: ${message}`);
    }
  });

  app.post("/auth/google/disconnect", (req, res) => {
    const sessionId = ensureViewerSession(req, res, store, config);
    clearTokens(store, sessionId);
    clearDisplayCache(store, sessionId);
    res.json({ ok: true });
  });

  if (config.nodeEnv === "production") {
    const frontendDist = path.resolve(projectRoot, "frontend", "dist");
    app.use(express.static(frontendDist, { index: false }));

    app.get(/^(?!\/api\/|\/auth\/).*/, async (req, res, next) => {
      try {
        ensureViewerSession(req, res, store, config);
        const html = await fs.readFile(path.join(frontendDist, "index.html"), "utf8");
        res.type("html").send(html);
      } catch (error) {
        next(error);
      }
    });
  } else {
    const { createServer: createViteServer, loadEnv } = await import("vite");
    const frontendEnv = loadEnv(config.nodeEnv, frontendRoot, "");
    const allowedHosts = (frontendEnv.VITE_ALLOWED_HOSTS ?? "kalender-opa.svcode.dev,localhost,127.0.0.1")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean);

    const vite = await createViteServer({
      appType: "spa",
      root: frontendRoot,
      server: {
        middlewareMode: true,
        host: true,
        allowedHosts
      }
    });

    app.use(vite.middlewares);

    app.get(/^(?!\/api\/|\/auth\/).*/, async (req, res, next) => {
      try {
        ensureViewerSession(req, res, store, config);
        const htmlPath = path.join(frontendRoot, "index.html");
        const template = await fs.readFile(htmlPath, "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).type("html").send(html);
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error(error);
    res.status(500).json({ error: message });
  });

  const server = app.listen(config.port, async () => {
    console.log(`kalender-opa listening on ${config.appBaseUrl} (port ${config.port})`);

    try {
      await syncAllCalendars(store, config);
    } catch (error) {
      console.error("Initial sync failed:", error);
    }
  });

  const interval = setInterval(async () => {
    try {
      await syncAllCalendars(store, config);
    } catch (error) {
      console.error("Scheduled sync failed:", error);
    }
  }, config.syncIntervalMs);

  const shutdown = () => {
    clearInterval(interval);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
