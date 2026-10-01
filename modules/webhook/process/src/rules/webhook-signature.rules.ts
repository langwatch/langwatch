import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe-style signing: `t=<unix seconds>,v1=<hex hmac-sha256>`, repeatable
 * during rotation (newest first, any match accepted). THE implementation,
 * synced via `specs/webhooks/signature-vectors.json` (also verified by the TS/Python SDKs).
 */
export const WEBHOOK_SIGNATURE_HEADER = "X-LangWatch-Signature";

/** Receiver-side freshness window, documented in the endpoint docs. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * How long a rolled-off secret keeps signing and verifying — long enough for
 * a receiver to notice the roll and deploy the new value, short enough that
 * a leaked secret's usefulness ends on a known clock.
 */
export const WEBHOOK_PREVIOUS_SECRET_TTL_MS = 24 * 60 * 60 * 1000;

function hmacHex(secret: string, signedPayload: string): string {
  return createHmac("sha256", secret).update(signedPayload).digest("hex");
}

/**
 * The signature header for a body, signed with every currently valid secret.
 * Takes a list, not one, because a rotation window has two (new and old);
 * order is newest first, so a reader of only the first `v1` follows the roll.
 */
export function signWebhookPayload({
  secrets,
  body,
  timestampSeconds,
}: {
  secrets: readonly string[];
  body: string;
  timestampSeconds: number;
}): string {
  const signedPayload = `${timestampSeconds}.${body}`;
  const signatures = secrets
    .filter((secret) => secret.length > 0)
    .map((secret) => `v1=${hmacHex(secret, signedPayload)}`);
  return [`t=${timestampSeconds}`, ...signatures].join(",");
}

/** Constant-time equality over the hex digests, length-safe. */
function digestsMatch(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The timestamp and every `v1` a signature header carries. */
function parseSignatureHeader(header: string): {
  timestamp?: number;
  candidates: string[];
} {
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    const key = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") candidates.push(value);
  }
  return { timestamp, candidates };
}

/**
 * Reference verifier receivers should implement. Every `v1` is checked,
 * since only one candidate matches this receiver's secret during a
 * rotation; every candidate is still compared after a match, so timing can't leak which.
 */
export function verifyWebhookSignature({
  secret,
  body,
  header,
  nowSeconds,
  toleranceSeconds = WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
}: {
  secret: string;
  body: string;
  header: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): boolean {
  const { timestamp, candidates } = parseSignatureHeader(header);

  if (timestamp === undefined || !Number.isFinite(timestamp)) return false;
  if (candidates.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = hmacHex(secret, `${timestamp}.${body}`);
  let matched = false;
  for (const candidate of candidates) {
    if (digestsMatch(expected, candidate)) matched = true;
  }
  return matched;
}
