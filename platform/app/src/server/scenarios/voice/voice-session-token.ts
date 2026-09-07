/**
 * The signed session token that binds a browser "Talk to it" call to the
 * project and agent it was minted for.
 *
 * Mint returns this token instead of a bare id; finish carries it back and
 * verifies it. Because the payload names the project, the transport, the agent
 * row and the vendor agent id — and is HMAC-signed with the app secret — a
 * finish cannot be pointed at another project's conversation, and a conversation
 * whose vendor agent id differs from the token's is rejected before anything is
 * written. The token is short-lived (the call budget plus a grace window).
 *
 * Server-only: it signs with `node:crypto` and the app's stored secret. The
 * ElevenLabs API key never appears in a token — only ids and the project it is
 * scoped to.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "~/env.mjs";
import {
  VOICE_TRANSPORTS,
  type VoiceTransport,
} from "~/server/agents/voice/voice-agent.config";

/** The claims carried in a signed voice session token. */
export interface VoiceSessionTokenPayload {
  /** Our correlation id for the call until the provider assigns one. */
  sessionId: string;
  /** The project the session was minted under; finish must match it. */
  projectId: string;
  /** The saved agent row id, or null for an agent the drawer had not saved. */
  agentId: string | null;
  /** The vendor agent id the session was minted for; the finished
   *  conversation's own agent id must equal this. */
  agentExternalId: string;
  transport: VoiceTransport;
  /** Expiry, ms since epoch. A token is invalid once `now >= exp`. */
  exp: number;
}

const payloadSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  agentId: z.string().min(1).nullable(),
  agentExternalId: z.string().min(1),
  transport: z.enum(
    VOICE_TRANSPORTS as unknown as [VoiceTransport, ...VoiceTransport[]],
  ),
  exp: z.number(),
});

/**
 * The signing secret for voice session tokens. Reuses the same
 * `CREDENTIALS_SECRET` / `NEXTAUTH_SECRET` pair the app already requires for
 * credential encryption and API-key hashing, so no new env var is introduced.
 */
function signingSecret(): string {
  const secret = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "voice session token secret not configured: set CREDENTIALS_SECRET or NEXTAUTH_SECRET",
    );
  }
  return secret;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * Encode and sign a payload as `<base64url(json)>.<base64url(hmac)>`. The
 * secret defaults to the app secret; tests pass their own.
 */
export function signVoiceSessionToken(
  payload: VoiceSessionTokenPayload,
  secret: string = signingSecret(),
): string {
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
export function verifyVoiceSessionToken(
  token: string,
  now: number,
  secret: string = signingSecret(),
): VoiceSessionTokenPayload | null {
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
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (now >= parsed.data.exp) return null;
  return parsed.data;
}
