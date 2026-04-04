import crypto from "node:crypto";

interface StatePayload {
  nonce: string;
  issuedAt: number;
  sessionId: string;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payloadPart: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

export function createStateToken(secret: string, sessionId: string): string {
  const payload: StatePayload = {
    nonce: crypto.randomBytes(16).toString("hex"),
    issuedAt: Date.now(),
    sessionId
  };

  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signaturePart = sign(payloadPart, secret);
  return `${payloadPart}.${signaturePart}`;
}

export function verifyStateToken(
  token: string,
  secret: string,
  maxAgeMs = 10 * 60 * 1000
): StatePayload | null {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const expectedSignature = sign(payloadPart, secret);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signaturePart, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart)) as StatePayload;
    if (Date.now() - payload.issuedAt > maxAgeMs) {
      return null;
    }

    if (!payload.sessionId) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
