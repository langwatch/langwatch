/**
 * Virtual-key crypto primitives. Mint, hash, verify, and inspect.
 *
 * Format: `lw_vk_{live|test}_<26-char Crockford base32 ULID>` (40 chars total).
 *   - Fixed prefix `lw_vk_` is grep/DLP-friendly.
 *   - Env segment (`live` / `test`) is Stripe-style blast-radius insurance.
 *   - Body is a monotonic ULID (128 random bits, 48 ms timestamp), encoded in
 *     Crockford base32 — sortable by creation time in dashboards.
 *
 * Storage:
 *   - Raw secret: displayed to the user exactly once, never stored.
 *   - `hashedSecret` column: `HMAC-SHA256(pepper, secret)` hex string (64 chars).
 *     Deterministic so we can look up a presented secret by hash directly in
 *     one indexed query.
 *   - `displayPrefix` column: first 18 chars (`lw_vk_live_01HZX9`) — safe to
 *     surface in UI, logs, and traces.
 *
 * Why HMAC-SHA256 instead of argon2id? The secret body has 128+ bits of
 * entropy so offline brute-force is not a threat that password-KDFs are
 * needed to mitigate. HMAC is what Stripe, GitHub, and similar API-key
 * systems use — it is fast (hot path cold-resolve) and deterministic
 * (enables single-query lookup-by-hash). The pepper (`LW_VIRTUAL_KEY_PEPPER`)
 * ensures a database leak alone is not sufficient to recover plaintext.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

import { env } from "~/env.mjs";

const VK_PREFIX = "lw_vk_";
const VK_ENVS = ["live", "test"] as const;

export type VirtualKeyEnvironment = (typeof VK_ENVS)[number];

// Crockford base32 alphabet (no I L O U to avoid visual ambiguity).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export class VirtualKeyCryptoError extends Error {
  constructor(
    public readonly code:
      | "malformed_key"
      | "invalid_env"
      | "pepper_missing"
      | "hash_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "VirtualKeyCryptoError";
  }
}

/**
 * Generate a 26-char Crockford-base32 ULID. Format:
 *   - first 10 chars: millisecond timestamp (48 bits)
 *   - last 16 chars: random (80 bits)
 *
 * Produces the same layout as the `ulid` npm package but avoids the dep.
 */
export function mintUlid(now: number = Date.now()): string {
  const out = new Array<string>(26);
  let ts = BigInt(now);
  for (let i = 9; i >= 0; i--) {
    out[i] = CROCKFORD[Number(ts & 0x1fn)] ?? "0";
    ts = ts >> 5n;
  }
  // 80 bits random → 16 base32 chars. Use a BigInt accumulator so bit-slicing
  // is boring and correct rather than subtly off.
  let rand = 0n;
  for (const byte of randomBytes(10)) {
    rand = (rand << 8n) | BigInt(byte);
  }
  for (let i = 15; i >= 0; i--) {
    out[10 + i] = CROCKFORD[Number(rand & 0x1fn)] ?? "0";
    rand = rand >> 5n;
  }
  return out.join("");
}

/**
 * Mint a new virtual-key secret. The resulting string is shown once to the
 * user and never stored in plaintext.
 */
export function mintVirtualKeySecret(
  environment: VirtualKeyEnvironment,
  now: number = Date.now(),
): string {
  if (!VK_ENVS.includes(environment)) {
    throw new VirtualKeyCryptoError("invalid_env", `unknown env: ${environment}`);
  }
  return `${VK_PREFIX}${environment}_${mintUlid(now)}`;
}

/**
 * Parse `lw_vk_{env}_{ulid}` and return its components. Throws on any
 * deviation from the canonical shape.
 */
export function parseVirtualKey(secret: string): {
  environment: VirtualKeyEnvironment;
  ulid: string;
  displayPrefix: string;
} {
  if (!secret.startsWith(VK_PREFIX)) {
    throw new VirtualKeyCryptoError("malformed_key", "missing lw_vk_ prefix");
  }
  const rest = secret.slice(VK_PREFIX.length);
  // env is followed by `_`, then 26-char ulid
  const underscore = rest.indexOf("_");
  if (underscore === -1) {
    throw new VirtualKeyCryptoError("malformed_key", "missing env segment");
  }
  const env = rest.slice(0, underscore);
  if (!(VK_ENVS as readonly string[]).includes(env)) {
    throw new VirtualKeyCryptoError(
      "invalid_env",
      `env must be one of ${VK_ENVS.join(", ")}`,
    );
  }
  const ulid = rest.slice(underscore + 1);
  if (ulid.length !== 26) {
    throw new VirtualKeyCryptoError("malformed_key", "ulid must be 26 chars");
  }
  if (!/^[0-9A-Z]+$/.test(ulid)) {
    throw new VirtualKeyCryptoError(
      "malformed_key",
      "ulid must be uppercase Crockford base32",
    );
  }
  // 18-char prefix: "lw_vk_" (6) + env (4) + "_" (1) + first 7 ulid chars = 18.
  // For "live" env that's `lw_vk_live_<7chars>` (18 chars).
  // For "test" env that's `lw_vk_test_<7chars>` (18 chars).
  const displayPrefix = secret.slice(0, 18);
  return { environment: env as VirtualKeyEnvironment, ulid, displayPrefix };
}

function getPepper(): string {
  const pepper =
    process.env.LW_VIRTUAL_KEY_PEPPER ?? env.LW_VIRTUAL_KEY_PEPPER;
  if (!pepper) {
    throw new VirtualKeyCryptoError(
      "pepper_missing",
      "LW_VIRTUAL_KEY_PEPPER is required to hash virtual-key secrets",
    );
  }
  return pepper;
}

/**
 * Peppered hash of a virtual-key secret. Deterministic so the control-plane
 * can look up a presented secret with a single indexed SELECT.
 */
export function hashVirtualKeySecret(secret: string): string {
  const pepper = getPepper();
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

/**
 * Constant-time comparison of a presented secret against the hashed form
 * stored in the database.
 */
export function verifyVirtualKeySecret(presented: string, stored: string): boolean {
  const computed = hashVirtualKeySecret(presented);
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(stored, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const VIRTUAL_KEY_DISPLAY_PREFIX_LENGTH = 18;
