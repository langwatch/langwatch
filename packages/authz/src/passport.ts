/**
 * ADR-092 §12 L2 — signed authz passports for stateless surfaces (collector,
 * Go gateway, share links). A passport carries the principal, per-scope
 * permission bitmaps, the org epoch it was minted under, and a short expiry.
 * Verification is an HMAC check plus an epoch compare — zero database.
 *
 * The in-house precedent is the gateway's 15-minute HS256 JWT with a
 * `revision` claim (server/gateway/gatewayJwt.ts); passports generalise the
 * idea to every principal with the registry's bitsets as the payload.
 *
 * The signing secret is a constructor dependency (plan decision D6) - the
 * app passes AUTHZ_PASSPORT_SECRET in when stage F wires passports.
 * Parameterised for purity: this package reads no env. A missing secret
 * fails closed: minting returns null, verification refuses.
 *
 * No consumers are wired in this PR — adoption is stage F per surface.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { encodePermissionBitset } from "./bitset";

const PASSPORT_VERSION = 1;
export const MAX_PASSPORT_TTL_SECONDS = 60;

/**
 * The base64url codecs for a bitset live here rather than in bitset.ts: they
 * are the passport wire format and they need node's Buffer, which the
 * browser-safe barrel must not pull in. The bit operations themselves
 * (encodePermissionBitset, bitsetHasPermission) stay pure and client-safe.
 */
export function bitsetToBase64Url(bitset: Uint8Array): string {
  return Buffer.from(bitset).toString("base64url");
}

export function bitsetFromBase64Url(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, "base64url"));
}

export type PassportPayload = {
  v: number;
  /** Principal reference, e.g. "user:abc" / "apiKey:def". */
  p: string;
  /** Organization the grants belong to. */
  o: string;
  /** Scope key → base64url permission bitset. */
  s: Record<string, string>;
  /** Org authz epoch at mint time. */
  e: number;
  /**
   * Unix seconds issuance time. Signed, so it is the anchor the TTL ceiling
   * is measured from: the token itself says how long a life it claims, and
   * that claim is checked without consulting either party's clock.
   */
  iat: number;
  /** Unix seconds expiry. */
  x: number;
};

export type PassportVerification =
  | { ok: true; payload: PassportPayload }
  | {
      ok: false;
      reason:
        | "malformed"
        | "bad-signature"
        | "expired"
        /** `x` sits further past `iat` than mint() can ever place it. */
        | "ttl-exceeded"
        | "stale-epoch"
        | "no-secret";
    };

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export class PassportService {
  constructor(
    private readonly options: {
      secret: string | undefined;
      now?: () => number;
    },
  ) {}

  mint({
    principal,
    organizationId,
    scopedPermissions,
    epoch,
    ttlSeconds = MAX_PASSPORT_TTL_SECONDS,
  }: {
    principal: { type: "user" | "apiKey"; id: string };
    organizationId: string;
    scopedPermissions: Array<{
      scopeKey: string;
      permissions: Iterable<string>;
    }>;
    epoch: number;
    ttlSeconds?: number;
  }): string | null {
    const { secret } = this.options;
    if (!secret) return null;

    const issuedAt = Math.floor(this.now() / 1000);
    const payload: PassportPayload = {
      v: PASSPORT_VERSION,
      p: `${principal.type}:${principal.id}`,
      o: organizationId,
      s: Object.fromEntries(
        scopedPermissions.map(({ scopeKey, permissions }) => [
          scopeKey,
          bitsetToBase64Url(encodePermissionBitset(permissions)),
        ]),
      ),
      e: epoch,
      iat: issuedAt,
      x: issuedAt + Math.min(ttlSeconds, MAX_PASSPORT_TTL_SECONDS),
    };

    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = sign(body, secret).toString("base64url");
    return `${body}.${signature}`;
  }

  verify({
    token,
    currentEpoch,
  }: {
    token: string;
    /** Fetched from the epoch store by the caller; null disables epoch check
     *  and fails closed (a passport must be provably fresh). */
    currentEpoch: number | null;
  }): PassportVerification {
    const { secret } = this.options;
    if (!secret) return { ok: false, reason: "no-secret" };

    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, reason: "malformed" };
    const [body, signature] = parts as [string, string];

    const expected = sign(body, secret);
    // Buffer.from never throws on a base64url string — invalid characters are
    // dropped, and the length compare below fails closed on the short result.
    const provided = Buffer.from(signature, "base64url");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return { ok: false, reason: "bad-signature" };
    }

    let payload: PassportPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (payload.v !== PASSPORT_VERSION) {
      return { ok: false, reason: "malformed" };
    }
    // Both timestamps are attacker-supplied until the signature vouches for
    // them; a non-integer would make every comparison below meaningless
    // (NaN loses silently), so the shape is checked before the values are.
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.x)) {
      return { ok: false, reason: "malformed" };
    }
    // The 60s ceiling is enforced at both ends. mint() clamps it, and a token
    // claiming a longer life than mint() can issue is refused here. The
    // ceiling is measured against the token's own signed issuance time, not
    // against the verifier's clock: a verifier running seconds behind the
    // issuer would otherwise reject honest max-TTL passports.
    if (payload.x > payload.iat + MAX_PASSPORT_TTL_SECONDS) {
      return { ok: false, reason: "ttl-exceeded" };
    }
    const nowSeconds = Math.floor(this.now() / 1000);
    if (nowSeconds >= payload.x) {
      return { ok: false, reason: "expired" };
    }
    if (currentEpoch === null || payload.e !== currentEpoch) {
      return { ok: false, reason: "stale-epoch" };
    }
    return { ok: true, payload };
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}
