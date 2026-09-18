/**
 * Signed session token: project, row id, transport, vendor agent. HMAC-verified
 * at finish (finish cannot be pointed at another project's call). Never holds ElevenLabs key.
 * Server-only; signing secret supplied by caller, never read from environment.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  type VoiceSessionTokenPayload,
  voiceSessionTokenPayloadSchema,
} from "@langwatch/scenario-contract";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * Encode and sign a payload as `<base64url(json)>.<base64url(hmac)>`. The
 * secret is always supplied by the caller.
 */
export function signVoiceSessionToken({
  payload,
  secret,
}: {
  payload: VoiceSessionTokenPayload;
  secret: string;
}): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verify a token's signature and expiry and return its payload, or `null` for
 * a malformed token, a bad signature, an unparsable or wrong-shaped payload, or
 * an expired one. Signature comparison is constant-time.
 */
export function verifyVoiceSessionToken({
  token,
  now,
  secret,
}: {
  token: string;
  now: number;
  secret: string;
}): VoiceSessionTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = voiceSessionTokenPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (now >= parsed.data.exp) return null;
  return parsed.data;
}
