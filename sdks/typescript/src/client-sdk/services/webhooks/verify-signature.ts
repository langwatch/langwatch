import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Receiver-side verification of a LangWatch webhook delivery.
 *
 * Every delivery carries
 *
 *   X-LangWatch-Signature: t=<unix seconds>,v1=<hex hmac-sha256>[,v1=<hex>]
 *
 * where each `v1` is HMAC-SHA256 over `"<t>.<raw body>"` under one currently
 * valid signing secret. `v1` REPEATS during a secret rotation, newest first,
 * which is what lets a receiver swap secrets on its own schedule instead of
 * dropping deliveries mid-swap.
 *
 * That repetition is the reason this helper exists. A hand-rolled parser that
 * keeps the LAST `v1` it sees, or splits the header into a flat key/value map,
 * rejects every delivery to a receiver that has already moved to the new
 * secret: the signature it kept is the one computed from the OLD secret. The
 * bug only appears during a rotation, which is exactly when a receiver can
 * least afford to be dropping deliveries.
 *
 * The algorithm here is pinned to the sender's by the vectors in
 * `specs/webhooks/signature-vectors.json`, generated from the server's own
 * signing code and asserted by the suite next to this file.
 */

/** The header a delivery carries its signature in. */
export const WEBHOOK_SIGNATURE_HEADER = "X-LangWatch-Signature";

/**
 * How far a delivery's timestamp may sit from the receiver's clock, in
 * seconds. Matches the sender's documented window.
 */
export const WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Why a delivery was refused. Switch on this rather than on the message: the
 * message is written for a human reading a log and will change, the code is
 * the contract.
 *
 * The three mean genuinely different things to an operator. `stale_timestamp`
 * is a clock or a replay and is worth alerting on; `invalid_signature` is a
 * wrong secret or a tampered body; `malformed_header` is almost always
 * something other than LangWatch posting to the URL.
 */
export type WebhookSignatureFailureCode =
  | "malformed_header"
  | "stale_timestamp"
  | "invalid_signature";

/**
 * A delivery that did not verify.
 *
 * One class carrying a `code` rather than three classes, because the SDK and
 * the platform both ask callers to branch on a stable code instead of on the
 * error's identity, which does not survive a serialization boundary.
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
   * The EXACT bytes of the request body, as received.
   *
   * Not a parsed object, and not the result of re-serializing one: the digest
   * is over the bytes the sender hashed, and `JSON.parse` followed by
   * `JSON.stringify` reorders keys, drops insignificant whitespace and
   * re-escapes non-ASCII, any of which changes the digest. Read the raw body
   * before your framework's JSON middleware does.
   */
  body: string | Uint8Array;
  /** The `X-LangWatch-Signature` header value, verbatim. */
  header: string;
  /**
   * The signing secret, or every secret this receiver currently accepts.
   *
   * Pass both values during a rotation and the delivery verifies under
   * either, so there is no window where deliveries are refused.
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
  const bytes =
    typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  return Buffer.concat([prefix, bytes]);
}

/**
 * Verify a webhook delivery, or throw explaining which check failed.
 *
 * ```ts
 * app.post("/langwatch", express.raw({ type: "application/json" }), (req, res) => {
 *   try {
 *     verifyWebhookSignature({
 *       body: req.body, // the raw Buffer, before JSON parsing
 *       header: req.header("X-LangWatch-Signature") ?? "",
 *       secret: [process.env.WEBHOOK_SECRET_NEW, process.env.WEBHOOK_SECRET_OLD],
 *     });
 *   } catch (error) {
 *     return res.status(400).send((error as WebhookSignatureVerificationError).code);
 *   }
 *   // Trusted from here.
 * });
 * ```
 *
 * Throws rather than returning false so that a delivery cannot be trusted by
 * forgetting to check a return value. The thrown
 * {@link WebhookSignatureVerificationError} carries a
 * {@link WebhookSignatureFailureCode} saying which check failed.
 *
 * Checks run in a fixed order, so a delivery that is both stale and wrongly
 * signed reports the staleness: a header that did not parse has no
 * trustworthy timestamp to judge, and a timestamp outside the window makes
 * the digest moot.
 *
 * A missing or empty secret is a configuration mistake rather than a bad
 * delivery, and raises `TypeError`. Reporting it as a failed verification
 * would let a receiver that lost its secret quietly refuse every delivery as
 * if the sender were at fault.
 */
export function verifyWebhookSignature(
  options: VerifyWebhookSignatureOptions,
): void {
  const secrets = (
    typeof options.secret === "string" ? [options.secret] : options.secret
  ).filter((secret) => typeof secret === "string" && secret.length > 0);
  if (secrets.length === 0) {
    throw new TypeError(
      "verifyWebhookSignature needs at least one non-empty signing secret",
    );
  }

  const tolerance =
    options.toleranceSeconds ?? WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS;
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
  let matched = false;
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    for (const candidate of candidates) {
      // Every pair is compared even once one has matched, so the work does
      // not depend on WHICH secret or which v1 was the right one.
      if (digestsMatch(expected, candidate)) matched = true;
    }
  }

  if (!matched) {
    throw new WebhookSignatureVerificationError(
      "invalid_signature",
      `no v1 signature in ${WEBHOOK_SIGNATURE_HEADER} matched the ${secrets.length === 1 ? "secret" : "secrets"} held, so the body was signed with something else or changed in transit`,
    );
  }
}
