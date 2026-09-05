/**
 * Virtual-key crypto: mint/hash/verify vk-lw-<ULID>. hashedSecret is HMAC-SHA256(pepper, secret) for deterministic lookup-by-hash in one indexed query; HMAC over argon2id since the secret already carries 128+ bits of entropy (no offline brute-force to mitigate) and must stay fast on the hot resolve path — same choice Stripe/GitHub API keys make. The pepper (LW_VIRTUAL_KEY_PEPPER) keeps a DB leak alone from recovering plaintext.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { GatewayVirtualKeyCryptoPort } from "../ports/gateway-virtual-key-crypto.port";

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

export class VirtualKeyCryptoAdapter extends GatewayVirtualKeyCryptoPort {
  static readonly displayPrefixLength = 13;

  static create(config: VirtualKeyCryptoConfig): VirtualKeyCryptoAdapter {
    return new VirtualKeyCryptoAdapter(config.pepper);
  }

  private constructor(private readonly pepper: string | undefined) {
    super();
  }

  /** The minting and parsing halves of the port, over this module's format. */
  mintSecret(nowMs: number = Date.now()): string {
    return VirtualKeyCryptoAdapter.mintSecret(nowMs);
  }

  parseSecret(secret: string): { ulid: string; displayPrefix: string } {
    return VirtualKeyCryptoAdapter.parseSecret(secret);
  }

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
