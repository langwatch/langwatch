/** The header every LangWatch delivery is signed in. */
export const WEBHOOK_SIGNATURE_HEADER = "X-LangWatch-Signature";
/** How far a `t=` timestamp may sit from the receiver's clock, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * How the endpoint signs: `v1` is `t=<unix seconds>,v1=<hex>` over `<t>.<raw body>` (every
 * endpoint registered today); `sha256` is the legacy `sha256=<hex>` over the raw body alone.
 */
export type WebhookSignatureScheme = "v1" | "sha256";

/** Switch on `code`; `message` is for logs and may change. */
export type WebhookSignatureFailureCode =
  | "malformed_header"
  | "stale_timestamp"
  | "invalid_signature";

export class WebhookSignatureVerificationError extends Error {
  readonly code: WebhookSignatureFailureCode;

  constructor({ code, message }: { code: WebhookSignatureFailureCode; message: string }) {
    super(message);
    this.name = "WebhookSignatureVerificationError";
    this.code = code;
  }
}

export interface VerifyWebhookSignatureOptions {
  /** The raw bytes received; parsing and re-serialising the JSON first breaks the digest. */
  body: string | Uint8Array;
  /** The `X-LangWatch-Signature` header value. */
  header: string | null | undefined;
  /** One secret, or every secret valid during a rotation (any match passes). */
  secret: string | readonly string[];
  /** Defaults to `v1`. Use `sha256` only for an endpoint that signs the legacy way. */
  scheme?: WebhookSignatureScheme;
  toleranceSeconds?: number;
  /** The receiver's clock, for tests. */
  nowSeconds?: number;
}

const HEX_DIGEST = /^[0-9a-f]{64}$/i;
const encoder = new TextEncoder();

/**
 * Resolves when the delivery is authentic; rejects with a
 * {@link WebhookSignatureVerificationError}.
 */
export async function verifyWebhookSignature(
  options: VerifyWebhookSignatureOptions,
): Promise<void> {
  const secrets = (
    typeof options.secret === "string" ? [options.secret] : [...options.secret]
  ).filter((secret) => secret.length > 0);
  if (secrets.length === 0) {
    throw new TypeError("verifyWebhookSignature needs at least one non-empty signing secret");
  }
  const header = options.header?.trim() ?? "";
  const body = typeof options.body === "string" ? encoder.encode(options.body) : options.body;
  const { payload, candidates } =
    options.scheme === "sha256"
      ? legacyPayload({ header, body })
      : timestampedPayload({ header, body, options });

  let matched = false;
  for (const secret of secrets) {
    for (const candidate of candidates) {
      // Every pair is checked even after a match, so timing does not reveal which secret held.
      if (await digestMatches({ secret, payload, candidate })) matched = true;
    }
  }
  if (!matched) {
    throw new WebhookSignatureVerificationError({
      code: "invalid_signature",
      message: "no signature in the header matches a held secret",
    });
  }
}

function malformed(message: string): WebhookSignatureVerificationError {
  return new WebhookSignatureVerificationError({ code: "malformed_header", message });
}

function legacyPayload({ header, body }: { header: string; body: Uint8Array }) {
  if (!header.startsWith("sha256=")) throw malformed("the header carries no sha256= signature");

  return { payload: Uint8Array.from(body), candidates: [header.slice("sha256=".length).trim()] };
}

function timestampedPayload({
  header,
  body,
  options,
}: {
  header: string;
  body: Uint8Array;
  options: VerifyWebhookSignatureOptions;
}) {
  let timestamp: string | undefined;
  const candidates: string[] = [];
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    const key = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (key === "v1") candidates.push(value);
    else if (key === "t" && value.length > 0) timestamp = value;
  }
  const seconds = Number(timestamp);
  if (timestamp === undefined || !Number.isInteger(seconds)) {
    throw malformed("the header carries no integer t= timestamp");
  }
  if (candidates.length === 0) throw malformed("the header carries no v1= signature");
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - seconds) > tolerance) {
    throw new WebhookSignatureVerificationError({
      code: "stale_timestamp",
      message: `the delivery was signed ${Math.abs(now - seconds)}s from now, outside the ${tolerance}s tolerance`,
    });
  }
  const prefix = encoder.encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.length + body.length);
  payload.set(prefix);
  payload.set(body, prefix.length);

  return { payload, candidates };
}

async function digestMatches({
  secret,
  payload,
  candidate,
}: {
  secret: string;
  payload: Uint8Array<ArrayBuffer>;
  candidate: string;
}): Promise<boolean> {
  if (!HEX_DIGEST.test(candidate)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = new Uint8Array(32);
  for (let index = 0; index < 32; index++) {
    signature[index] = Number.parseInt(candidate.slice(index * 2, index * 2 + 2), 16);
  }

  // `subtle.verify` compares in constant time.
  return crypto.subtle.verify("HMAC", key, signature, payload);
}
