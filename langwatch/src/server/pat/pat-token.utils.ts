import crypto from "node:crypto";
import { customAlphabet } from "nanoid";

const LOOKUP_ID_LENGTH = 16;
const SECRET_LENGTH = 48;
const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const generateId = customAlphabet(ALPHABET, LOOKUP_ID_LENGTH);
const generateSecret = customAlphabet(ALPHABET, SECRET_LENGTH);

export const PAT_PREFIX = "pat-lw-";
export const LEGACY_PREFIX = "sk-lw-";

/**
 * Generates a new split-format PAT token.
 *
 * Format: pat-lw-{lookupId}_{secret}
 *   - lookupId: indexed in plaintext for O(1) DB lookup
 *   - secret: stored as SHA-256 hash only
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
 * Hashes a secret using SHA-256. Deterministic and fast — suitable for
 * per-request verification on the hot path.
 */
export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * Verifies a secret against a stored hash.
 */
export function verifySecret(secret: string, hashedSecret: string): boolean {
  return crypto.timingSafeEqual(
    Buffer.from(hashSecret(secret), "hex"),
    Buffer.from(hashedSecret, "hex"),
  );
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
