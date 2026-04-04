import crypto from "node:crypto";
import { Request, Response } from "express";
import { KeyValueStore } from "./db";
import { AppConfig } from "./types";

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex < 0) {
          return [part, ""];
        }

        const name = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        return [name, decodeURIComponent(value)];
      })
  );
}

export function createSessionId(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function getSessionIdFromRequest(req: Request, config: AppConfig): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const value = cookies[config.sessionCookieName];
  return value || null;
}

export function setSessionCookie(req: Request, res: Response, config: AppConfig, sessionId: string): void {
  const maxAgeSeconds = config.sessionCookieMaxAgeDays * 24 * 60 * 60;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "");
  const isSecure = req.secure || forwardedProto.includes("https");

  res.cookie(config.sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    maxAge: maxAgeSeconds * 1000,
    path: "/"
  });
}

export function ensureViewerSession(req: Request, res: Response, store: KeyValueStore, config: AppConfig): string {
  const existingSessionId = getSessionIdFromRequest(req, config);
  if (existingSessionId) {
    store.ensureSession(existingSessionId);
    return existingSessionId;
  }

  const sessionId = createSessionId();
  store.ensureSession(sessionId);
  setSessionCookie(req, res, config, sessionId);
  return sessionId;
}
