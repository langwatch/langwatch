import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe-style webhook signing: the header carries the signing timestamp
 * and an HMAC over `"<t>.<raw body>"`, so a receiver can verify both
 * authenticity and freshness. Verification recomputes the HMAC from the
 * RAW request bytes (any re-serialization breaks it) and rejects
 * timestamps outside the tolerance window to blunt replay.
 *
 *   X-LangWatch-Signature: t=<unix seconds>,v1=<hex hmac-sha256>
 */
export const WEBHOOK_SIGNATURE_HEADER = "X-LangWatch-Signature";

/** Receiver-side freshness window, documented in the endpoint docs. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function signWebhookPayload({
  secret,
  body,
  timestampSeconds,
}: {
  secret: string;
  body: string;
  timestampSeconds: number;
}): string {
  const v1 = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${body}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${v1}`;
}

/**
 * Reference verifier: the exact check receivers should implement, used by
 * our own tests and the endpoint test-send round trip. Constant-time
 * comparison; tolerance defaults to five minutes.
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
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0)
      parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${t}.${body}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
