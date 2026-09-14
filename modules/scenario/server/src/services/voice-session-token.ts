/**
 * The signed session token that binds a browser "Talk to it" call to the
 * project, the vendor agent it was minted for, and the saved agent row when
 * one already exists.
 *
 * Mint returns this token instead of a bare id; finish carries it back and
 * verifies it. The payload names the project, the row id (or null for an
 * unsaved draft — the row is created at finish), the transport and the
 * vendor agent id — server-resolved from the row's own stored config when a
 * row exists, otherwise taken from the mint request for a not-yet-saved
 * draft — and is HMAC-signed with the app secret, so finish cannot be pointed
 * at another project's conversation. Ownership here is at the granularity of
 * the ElevenLabs key the project resolves to: an organization where several
 * projects share one key can mint and finish against any agent visible to
 * that key, since the key itself, not the row, is what ElevenLabs checks.
 * Once the provider's own record for the conversation is available, finish
 * refuses it outright if that record names a different vendor agent than the
 * token. Before the provider record is ready (or when the fetch fails),
 * finish falls back to the client's live transcript, trusted only as far as
 * the token's project — there is no provider record yet to check it against.
 * The token is short-lived (the call budget plus a grace window).
 *
 * Server-only: it signs with `node:crypto` and a secret the deployment holds.
 * The ElevenLabs API key never appears in a token — only ids and the project
 * it is scoped to.
 *
 * The secret is a required argument, never read here. Nothing in this package
 * may reach for an environment variable of its own
 * (`langwatch/secrets-through-source`): whoever composes the voice session
 * infrastructure hands the signing secret down with the rest of its
 * collaborators, so the one place a deployment's secret is resolved stays the
 * composition root.
 */

import {
  type VoiceSessionTokenPayload,
  voiceSessionTokenPayloadSchema,
} from "@langwatch/scenario-contract";
import { createHmac, timingSafeEqual } from "node:crypto";

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
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
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
