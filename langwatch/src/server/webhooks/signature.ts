import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe-style webhook signing: the header carries the signing timestamp
 * and an HMAC over `"<t>.<raw body>"`, so a receiver can verify both
 * authenticity and freshness. Verification recomputes the HMAC from the
 * RAW request bytes (any re-serialization breaks it) and rejects
 * timestamps outside the tolerance window to blunt replay.
 *
 *   X-LangWatch-Signature: t=<unix seconds>,v1=<hex hmac-sha256>
 *
 * `v1` MAY REPEAT. During a secret rotation the header carries one `v1` per
 * secret currently valid, newest first:
 *
 *   X-LangWatch-Signature: t=<unix seconds>,v1=<new>,v1=<old>
 *
 * A receiver must therefore accept the delivery when ANY `v1` matches, which
 * is what lets it swap secrets on its own schedule instead of dropping
 * deliveries during the swap. Mirrors the gateway JWT's {current, previous}
 * verification key set.
 */
export const WEBHOOK_SIGNATURE_HEADER = "X-LangWatch-Signature";

/** Receiver-side freshness window, documented in the endpoint docs. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * How long a rolled-off secret keeps signing and verifying.
 *
 * Long enough for a receiver to notice the roll and deploy the new value,
 * short enough that a leaked secret's usefulness ends on a known clock.
 */
export const WEBHOOK_PREVIOUS_SECRET_TTL_MS = 24 * 60 * 60 * 1000;

function hmacHex(secret: string, signedPayload: string): string {
  return createHmac("sha256", secret).update(signedPayload).digest("hex");
}

/**
 * The signature header for a body, signed with every currently valid secret.
 *
 * Takes a list rather than one secret because a rotation window has two: the
 * new one a receiver may already have swapped to, and the old one it may not
 * have. Order is newest first, so a receiver that reads only the first `v1`
 * follows the roll rather than lagging it.
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

/**
 * Reference verifier: the exact check receivers should implement, used by
 * our own tests and the endpoint test-send round trip. Constant-time
 * comparison; tolerance defaults to five minutes.
 *
 * Every `v1` in the header is checked, because a rotation window carries more
 * than one and only one of them is computed from the secret this receiver
 * holds. Every candidate is compared even after a match so the work does not
 * depend on WHICH signature matched.
 */
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
