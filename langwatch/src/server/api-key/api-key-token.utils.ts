import crypto from "node:crypto";
import { customAlphabet } from "nanoid";
import { env } from "~/env.mjs";

const LOOKUP_ID_LENGTH = 16;
const SECRET_LENGTH = 48;
const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const generateId = customAlphabet(ALPHABET, LOOKUP_ID_LENGTH);
const generateSecret = customAlphabet(ALPHABET, SECRET_LENGTH);

/**
 * New API keys use the `sk-lw-` prefix (unified with legacy project keys).
 * Old PATs minted with `pat-lw-` are still accepted for backward compat.
 */
export const API_KEY_PREFIX = "sk-lw-";
export const LEGACY_PAT_PREFIX = "pat-lw-";
export const LEGACY_PROJECT_KEY_PREFIX = "sk-lw-";

/**
 * Returns the server-side pepper used when HMAC-hashing API key secrets.
 *
 * Using HMAC-SHA256 with a pepper (rather than plain SHA-256) means a
 * DB-only leak is useless on its own: the attacker needs the pepper
 * too. We reuse the same `CREDENTIALS_SECRET` / `NEXTAUTH_SECRET` pair
 * already required for AES encryption of stored credentials, so no new
 * env var is introduced.
 *
 * API key secrets are 48 chars from a 62-char alphabet (~286 bits of
 * entropy), so the hash algorithm's computational cost is irrelevant
 * to brute-force resistance — we deliberately don't use a slow KDF
 * (bcrypt/argon2) because `verifySecret` runs on every authenticated
 * request and any extra latency would be a DoS surface.
 */
function getApiKeyPepper(): string {
  const pepper = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!pepper) {
    throw new Error(
      "API key pepper not configured: set CREDENTIALS_SECRET or NEXTAUTH_SECRET",
    );
  }
  return pepper;
}

/**
 * Generates a new split-format API key token.
 *
 * Format: sk-lw-{lookupId}_{secret}
 *   - lookupId: indexed in plaintext for O(1) DB lookup
 *   - secret: stored as HMAC-SHA256 hash
 *
 * Returns the full plaintext token (shown once to user),
 * plus the lookupId and hashedSecret for DB storage.
 */
export function generateApiKeyToken(): {
  token: string;
  lookupId: string;
  hashedSecret: string;
} {
  const lookupId = generateId();
  const secret = generateSecret();
  const token = `${API_KEY_PREFIX}${lookupId}_${secret}`;
  const hashedSecret = hashSecret(secret);

  return { token, lookupId, hashedSecret };
}

/**
 * Splits an API key token string into its lookupId and secret components.
 * Accepts both new `sk-lw-` and old `pat-lw-` prefixes.
 * Returns null if the token format is invalid.
 */
export function splitApiKeyToken(
  token: string,
): { lookupId: string; secret: string } | null {
  let body: string;
  if (token.startsWith(LEGACY_PAT_PREFIX)) {
    body = token.slice(LEGACY_PAT_PREFIX.length);
  } else if (token.startsWith(API_KEY_PREFIX)) {
    body = token.slice(API_KEY_PREFIX.length);
  } else {
    return null;
  }

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
 * HMAC-SHA256 of an API key secret, keyed by the server pepper.
 * Used for all newly created keys.
 */
// eslint-disable-next-line @codeql/js/insufficient-password-hash -- machine-generated 286-bit secret, not a user password
export function hashSecret(secret: string): string {
  return crypto
    .createHmac("sha256", getApiKeyPepper())
    .update(secret)
    .digest("hex");
}

/**
 * Plain SHA-256 hash — the algorithm used by PATs created before the
 * HMAC-pepper upgrade. Kept only for backward-compat verification.
 * New keys are never hashed with this function.
 */
function hashSecretLegacy(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * Verifies a secret against a stored hash.
 *
 * Tries HMAC-SHA256 (current) first. If that fails, falls back to
 * plain SHA-256 (legacy) for keys created before the pepper upgrade.
 *
 * Returns:
 *  - "match"          — verified with current HMAC algorithm
 *  - "match_legacy"   — verified with legacy SHA-256 (caller should re-hash)
 *  - "no_match"       — neither algorithm matched
 */
export function verifySecret(
  secret: string,
  hashedSecret: string,
): "match" | "match_legacy" | "no_match" {
  // Try current HMAC-SHA256 first
  const hmacHash = Buffer.from(hashSecret(secret), "hex");
  const stored = Buffer.from(hashedSecret, "hex");

  if (hmacHash.length === stored.length && crypto.timingSafeEqual(hmacHash, stored)) {
    return "match";
  }

  // Fall back to legacy plain SHA-256
  const legacyHash = Buffer.from(hashSecretLegacy(secret), "hex");

  if (legacyHash.length === stored.length && crypto.timingSafeEqual(legacyHash, stored)) {
    return "match_legacy";
  }

  return "no_match";
}

/**
 * Determines the token type from its prefix and structure.
 *
 * - `pat-lw-*` → always an API key (old PAT format, backward compat)
 * - `sk-lw-{16chars}_{48chars}` → API key (new format, has underscore separator)
 * - `sk-lw-*` (no underscore) → legacy project key
 * - anything else → unknown
 */
export function getTokenType(
  token: string,
): "apiKey" | "legacyProjectKey" | "unknown" {
  if (token.startsWith(LEGACY_PAT_PREFIX)) return "apiKey";
  if (token.startsWith(API_KEY_PREFIX)) {
    // Distinguish new-format API keys from legacy project keys by structure:
    // API keys have an underscore separating lookupId and secret
    const body = token.slice(API_KEY_PREFIX.length);
    return body.includes("_") ? "apiKey" : "legacyProjectKey";
  }
  return "unknown";
}
