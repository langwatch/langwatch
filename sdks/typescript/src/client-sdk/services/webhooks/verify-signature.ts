import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify webhook delivery signature in X-LangWatch-Signature header.
 * Handles secret rotation: v1 repeats with newest first.
 * Pinned to sender's algorithm by specs/webhooks/signature-vectors.json.
 */

/** The header a delivery carries its signature in. */
export const WEBHOOK_SIGNATURE_HEADER = "X-LangWatch-Signature";

/**
 * Identifies one delivery ATTEMPT on the webhook platform's endpoints. The
 * natural idempotency key: retries of the same batch repeat it, so a
 * receiver that already processed this id can stop, not apply it twice.
 */
export const WEBHOOK_DELIVERY_ID_HEADER = "X-LangWatch-Delivery-Id";

/**
 * The same role on automation deliveries (graph alerts and friends), which
 * group attempts by the logical fire rather than the batch. Two names
 * because they are two senders: read whichever the delivery carries.
 */
export const WEBHOOK_EVENT_ID_HEADER = "X-LangWatch-Event-Id";

/**
 * How far a delivery's timestamp may sit from the receiver's clock, in
 * seconds. Matches the sender's documented window.
 */
export const WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Why a delivery was refused: malformed_header, stale_timestamp, invalid_signature.
 * Switch on code, not message; message is for logs and may change.
 */
export type WebhookSignatureFailureCode =
  | "malformed_header"
  | "stale_timestamp"
  | "invalid_signature";

/**
 * A delivery that did not verify. Use code, not error type, to branch logic.
 */
export class WebhookSignatureVerificationError extends Error {
  readonly code: WebhookSignatureFailureCode;

  constructor(code: WebhookSignatureFailureCode, message: string) {
    super(message);
    this.name = "WebhookSignatureVerificationError";
    this.code = code;
  }
}

export interface VerifyWebhookSignatureOptions {
  /**
   * The EXACT bytes of the request body, as received — not a parsed or
   * re-serialized object: `JSON.stringify` reorders keys and re-escapes
   * text, changing the digest. Read the raw body before your JSON middleware.
   */
  body: string | Uint8Array;
  /** The `X-LangWatch-Signature` header value, verbatim. */
  header: string;
  /**
   * The signing secret, or every secret this receiver currently accepts.
   * Pass both during a rotation and the delivery verifies under either, so
   * there is no window where deliveries are refused.
   */
  secret: string | readonly string[];
  /**
   * Freshness window in seconds, defaulting to the sender's five minutes.
   * Tighten it only if your clocks are disciplined.
   */
  toleranceSeconds?: number;
  /**
   * The current time in unix SECONDS. Defaults to the system clock; pass it
   * to verify a delivery captured earlier, or from a test.
   */
  nowSeconds?: number;
}

/** The timestamp and EVERY `v1` the header carries, in the order sent. */
function parseSignatureHeader(header: string): {
  timestamp: number | undefined;
  candidates: string[];
} {
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    const key = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    // Every `v1` is kept. Keeping only one is the rotation bug this helper
    // exists to make impossible.
    if (key === "v1") candidates.push(value);
    else if (key === "t" && value.length > 0) timestamp = Number(value);
  }
  return { timestamp, candidates };
}

/** Constant-time equality over two hex digests, length-safe. */
function digestsMatch(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function signedPayload(timestamp: number, body: string | Uint8Array): Buffer {
  const prefix = Buffer.from(`${timestamp}.`, "utf8");
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  return Buffer.concat([prefix, bytes]);
}

function matchesAnySignature({
  secrets,
  candidates,
  payload,
}: {
  secrets: string[];
  candidates: string[];
  payload: Buffer;
}): boolean {
  let matched = false;

  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    for (const candidate of candidates) {
      // Every pair is compared even once one has matched, so the work does
      // not depend on WHICH secret or which v1 was the right one.
      if (digestsMatch(expected, candidate)) matched = true;
    }
  }

  return matched;
}

/**
 * Verify a webhook delivery, throwing (not returning false) so a check can't
 * be skipped by accident. A missing/empty secret throws a plain `TypeError`
 * instead of a verification failure, so it's never mistaken for sender fault.
 */
export function verifyWebhookSignature(options: VerifyWebhookSignatureOptions): void {
  const secrets = (typeof options.secret === "string" ? [options.secret] : options.secret).filter(
    (secret) => typeof secret === "string" && secret.length > 0,
  );
  if (secrets.length === 0) {
    throw new TypeError("verifyWebhookSignature needs at least one non-empty signing secret");
  }

  const tolerance = options.toleranceSeconds ?? WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const { timestamp, candidates } = parseSignatureHeader(options.header);
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    throw new WebhookSignatureVerificationError(
      "malformed_header",
      `${WEBHOOK_SIGNATURE_HEADER} carries no readable t= timestamp, so the delivery cannot be checked for freshness`,
    );
  }
  if (candidates.length === 0) {
    throw new WebhookSignatureVerificationError(
      "malformed_header",
      `${WEBHOOK_SIGNATURE_HEADER} carries no v1= signature, so there is nothing to compare`,
    );
  }

  if (Math.abs(now - timestamp) > tolerance) {
    throw new WebhookSignatureVerificationError(
      "stale_timestamp",
      `the delivery was signed ${Math.abs(now - timestamp)}s from now, outside the ${tolerance}s tolerance`,
    );
  }

  const payload = signedPayload(timestamp, options.body);
  const matched = matchesAnySignature({ secrets, candidates, payload });

  if (!matched) {
    throw new WebhookSignatureVerificationError(
      "invalid_signature",
      `no v1 signature in ${WEBHOOK_SIGNATURE_HEADER} matched the ${secrets.length === 1 ? "secret" : "secrets"} held, so the body was signed with something else or changed in transit`,
    );
  }
}
