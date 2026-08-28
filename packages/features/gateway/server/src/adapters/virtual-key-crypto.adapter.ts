/**
 * Virtual-key crypto primitives. Mint, hash, verify, and inspect.
 *
 * Format: `vk-lw-<26-char Crockford base32 ULID>` (32 chars total).
 *   - Fixed prefix `vk-lw-` is grep/DLP-friendly + function-named, paired
 *     with `sk-lw-` (secret / ingestion keys) and `pat-lw-` (legacy).
 *   - Body is a monotonic ULID (128 random bits, 48 ms timestamp), encoded in
 *     Crockford base32 — sortable by creation time in dashboards.
 *
 * Storage:
 *   - Raw secret: displayed to the user exactly once, never stored.
 *   - `hashedSecret` column: `HMAC-SHA256(pepper, secret)` hex string (64 chars).
 *     Deterministic so we can look up a presented secret by hash directly in
 *     one indexed query.
 *   - `displayPrefix` column: first 13 chars (`vk-lw-01HZX9N`) — safe to
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

const VK_PREFIX = "vk-lw-";

// Crockford base32 alphabet (no I L O U to avoid visual ambiguity).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export class VirtualKeyCryptoError extends Error {
  constructor(
    public readonly code: "malformed_key" | "pepper_missing" | "hash_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "VirtualKeyCryptoError";
  }
}

/**
 * Process-injected cryptographic material for virtual keys. The pepper stays
 * optional so an unconfigured process retains the legacy operation-time
 * `pepper_missing` failure; the feature never reads an ambient environment source.
 */
export type VirtualKeyCryptoConfig = {
  pepper?: string;
};

export class VirtualKeyCryptoAdapter {
  static readonly displayPrefixLength = 13;

  static create(config: VirtualKeyCryptoConfig): VirtualKeyCryptoAdapter {
    return new VirtualKeyCryptoAdapter(config.pepper);
  }

  private constructor(private readonly pepper: string | undefined) {}

  hashSecret(secret: string): string {
    const pepper = this.pepper;
    if (!pepper) {
      throw new VirtualKeyCryptoError(
        "pepper_missing",
        "LW_VIRTUAL_KEY_PEPPER is required to hash virtual-key secrets",
      );
    }
    return createHmac("sha256", pepper).update(secret).digest("hex");
  }

  verifySecret(presented: string, stored: string): boolean {
    const computed = this.hashSecret(presented);
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(stored, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Generates a sortable 26-character Crockford-base32 ULID. */
  static mintUlid(now: number = Date.now()): string {
    const out = Array.from({ length: 26 }, () => "");
    let ts = BigInt(now);
    for (let i = 9; i >= 0; i--) {
      out[i] = CROCKFORD[Number(ts & 0x1fn)] ?? "0";
      ts = ts >> 5n;
    }
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

  /** Mints a virtual-key secret that is shown once and never stored plaintext. */
  static mintSecret(now: number = Date.now()): string {
    return `${VK_PREFIX}${VirtualKeyCryptoAdapter.mintUlid(now)}`;
  }

  /** Parses the canonical virtual-key format. */
  static parseSecret(secret: string): { ulid: string; displayPrefix: string } {
    if (!secret.startsWith(VK_PREFIX)) {
      throw new VirtualKeyCryptoError("malformed_key", "missing vk-lw- prefix");
    }
    const ulid = secret.slice(VK_PREFIX.length);
    if (ulid.length !== 26) {
      throw new VirtualKeyCryptoError("malformed_key", "ulid must be 26 chars");
    }
    if (!/^[0-9A-Z]+$/.test(ulid)) {
      throw new VirtualKeyCryptoError("malformed_key", "ulid must be uppercase Crockford base32");
    }
    const displayPrefix = secret.slice(0, VirtualKeyCryptoAdapter.displayPrefixLength);
    return { ulid, displayPrefix };
  }
}
