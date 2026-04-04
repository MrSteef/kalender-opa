import { google } from "googleapis";
import { AppConfig, StoredTokens } from "./types";

export function getRedirectUri(config: AppConfig): string {
  return `${config.appBaseUrl}/auth/google/callback`;
}

export function createOAuthClient(config: AppConfig) {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    getRedirectUri(config)
  );
}

export function createAuthorizedOAuthClient(config: AppConfig, tokens: StoredTokens) {
  const client = createOAuthClient(config);
  client.setCredentials({
    refresh_token: tokens.refreshToken,
    access_token: tokens.accessToken,
    expiry_date: tokens.expiryDate ?? undefined,
    scope: tokens.scope,
    token_type: tokens.tokenType
  });
  return client;
}
