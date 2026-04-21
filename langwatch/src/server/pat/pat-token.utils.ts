import crypto from "node:crypto";
import { customAlphabet } from "nanoid";
import { env } from "~/env.mjs";

const LOOKUP_ID_LENGTH = 16;
const SECRET_LENGTH = 48;
const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const generateId = customAlphabet(ALPHABET, LOOKUP_ID_LENGTH);
const generateSecret = customAlphabet(ALPHABET, SECRET_LENGTH);

export const PAT_PREFIX = "pat-lw-";
export const LEGACY_PREFIX = "sk-lw-";

/**
 * Returns the server-side pepper used when HMAC-hashing PAT secrets.
 *
 * Using HMAC-SHA256 with a pepper (rather than plain SHA-256) means a
 * DB-only leak is useless on its own: the attacker needs the pepper
 * too. We reuse the same `CREDENTIALS_SECRET` / `NEXTAUTH_SECRET` pair
 * already required for AES encryption of stored credentials, so no new
 * env var is introduced.
 *
 * PAT secrets are 48 chars from a 62-char alphabet (~286 bits of
 * entropy), so the hash algorithm's computational cost is irrelevant
 * to brute-force resistance — we deliberately don't use a slow KDF
 * (bcrypt/argon2) because `verifySecret` runs on every authenticated
 * request and any extra latency would be a DoS surface.
 */
function getPatPepper(): string {
  const pepper = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!pepper) {
    throw new Error(
      "PAT pepper not configured: set CREDENTIALS_SECRET or NEXTAUTH_SECRET",
    );
  }
  return pepper;
}

/**
 * Generates a new split-format PAT token.
 *
 * Format: pat-lw-{lookupId}_{secret}
 *   - lookupId: indexed in plaintext for O(1) DB lookup
 *   - secret: stored as HMAC-SHA256 digest only (see `hashSecret`)
 *
 * Returns the full plaintext token (shown once to user),
 * plus the lookupId and hashedSecret for DB storage.
 */
export function generatePatToken(): {
  token: string;
  lookupId: string;
  hashedSecret: string;
} {
  const lookupId = generateId();
  const secret = generateSecret();
  const token = `${PAT_PREFIX}${lookupId}_${secret}`;
  const hashedSecret = hashSecret(secret);

  return { token, lookupId, hashedSecret };
}

/**
 * Splits a PAT token string into its lookupId and secret components.
 * Returns null if the token format is invalid.
 */
export function splitPatToken(
  token: string,
): { lookupId: string; secret: string } | null {
  if (!token.startsWith(PAT_PREFIX)) {
    return null;
  }

  const body = token.slice(PAT_PREFIX.length);
  const separatorIndex = body.indexOf("_");
  if (separatorIndex === -1) {
    return null;
  }

  const lookupId = body.slice(0, separatorIndex);
  const secret = body.slice(separatorIndex + 1);

  if (!lookupId || !secret) {
    return null;
  }

  return { lookupId, secret };
}

/**
 * HMAC-SHA256 of a PAT secret, keyed by the server pepper. Deterministic
 * and fast — suitable for per-request verification on the hot path.
 *
 * See `getPatPepper` for the rationale behind HMAC-over-pepper vs a
 * slow KDF here.
 */
export function hashSecret(secret: string): string {
  return crypto
    .createHmac("sha256", getPatPepper())
    .update(secret)
    .digest("hex");
}

/**
 * Verifies a secret against a stored hash.
 * Returns false (instead of throwing) when the hash lengths differ,
 * which can happen if hashedSecret is corrupt or a different algorithm.
 */
export function verifySecret(secret: string, hashedSecret: string): boolean {
  const computed = Buffer.from(hashSecret(secret), "hex");
  const stored = Buffer.from(hashedSecret, "hex");

  if (computed.length !== stored.length) return false;

  return crypto.timingSafeEqual(computed, stored);
}

/**
 * Determines the token type from its prefix.
 */
export function getTokenType(
  token: string,
): "pat" | "legacy" | "unknown" {
  if (token.startsWith(PAT_PREFIX)) return "pat";
  if (token.startsWith(LEGACY_PREFIX)) return "legacy";
  return "unknown";
}
