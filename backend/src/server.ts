import "dotenv/config";
import express, { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./env";
import { KeyValueStore } from "./db";
import { createOAuthClient } from "./google";
import { createStateToken, verifyStateToken } from "./state-token";
import { clearDisplayCache, clearTokens, loadDisplayCache, readTokens, saveTokens, syncCalendarNow } from "./sync";
import { AdminStatus, StoredTokens } from "./types";

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

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      env: config.nodeEnv,
      time: new Date().toISOString()
    });
  });

  app.get("/api/display", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const tokens = readTokens(store);
    if (tokens && !loadDisplayCache(store, config).lastSyncedAt) {
      try {
        await syncCalendarNow(store, config);
      } catch {
        // Keep serving the cached version if sync fails.
      }
    }

    res.json(loadDisplayCache(store, config));
  });

  app.get("/api/admin/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const tokens = readTokens(store);
    const display = loadDisplayCache(store, config);

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
      appBaseUrl: config.appBaseUrl
    };

    res.json(status);
  });

  app.post("/api/admin/resync", async (_req, res) => {
    try {
      await syncCalendarNow(store, config);
      res.json({
        ok: true,
        display: loadDisplayCache(store, config)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown resync error";
      res.status(500).json({
        ok: false,
        error: message
      });
    }
  });

  app.get("/auth/google/start", (_req, res) => {
    const state = createStateToken(config.stateSecret);
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

    if (!verifyStateToken(state, config.stateSecret)) {
      res.status(400).send("Invalid or expired OAuth state.");
      return;
    }

    if (!code) {
      res.status(400).send("Missing authorization code.");
      return;
    }

    try {
      const oauthClient = createOAuthClient(config);
      const { tokens } = await oauthClient.getToken(code);

      const existing = readTokens(store);
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

      saveTokens(store, storedTokens);
      await syncCalendarNow(store, config);

      res.redirect("/");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown OAuth error";
      res.status(500).send(`Failed to connect Google Calendar: ${message}`);
    }
  });

  app.post("/auth/google/disconnect", (_req, res) => {
    clearTokens(store);
    clearDisplayCache(store);
    res.json({ ok: true });
  });

  if (config.nodeEnv === "production") {
    const frontendDist = path.resolve(projectRoot, "frontend", "dist");
    app.use(express.static(frontendDist, { index: false }));

    app.get(/^(?!\/api\/|\/auth\/).*/, async (_req, res, next) => {
      try {
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
      await syncCalendarNow(store, config);
    } catch (error) {
      console.error("Initial sync failed:", error);
    }
  });

  const interval = setInterval(async () => {
    try {
      await syncCalendarNow(store, config);
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

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
