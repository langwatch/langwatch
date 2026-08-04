import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** 256 bits — the reason guessing a claim token is hopeless on paper. */
const TOKEN_BYTES = 32;

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** A claim token or handoff code. Returned once, then only its hash is kept. */
export function mintSecret(): string {
  return base64Url(randomBytes(TOKEN_BYTES));
}

/**
 * A short string a human can read back over a shoulder or a video call to
 * confirm the browser is approving the same handoff the terminal started.
 * Ambiguous glyphs (0/O, 1/I) are out of the alphabet.
 */
export function mintUserCode(): string {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => USER_CODE_ALPHABET[b % 32]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * Keyed hash for anything we must be able to compare but must never be able
 * to read back: claim tokens, handoff codes, client fingerprints, source IPs.
 *
 * Peppered rather than plain SHA-256 so a database dump cannot be brute-forced
 * back into "which IPs and machines tried LangWatch" — the search space for an
 * IPv4 address is small enough to exhaust in seconds without the key.
 */
export function peppered(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

/**
 * RFC 7636 S256: the challenge is the base64url SHA-256 of the verifier. The
 * verifier itself is never stored, so a dump of pending handoffs cannot be
 * replayed into completed claims.
 */
export function deriveCodeChallenge(codeVerifier: string): string {
  return base64Url(createHash("sha256").update(codeVerifier).digest());
}

/** Constant-time compare of two same-encoding strings. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak
  // length — compare lengths first and always run the digest compare.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyCodeChallenge(params: {
  codeVerifier: string;
  codeChallenge: string;
}): boolean {
  return secretsMatch(
    deriveCodeChallenge(params.codeVerifier),
    params.codeChallenge,
  );
}
