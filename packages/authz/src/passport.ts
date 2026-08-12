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
import { bitsetToBase64Url, encodePermissionBitset } from "./bitset";

const PASSPORT_VERSION = 1;
export const MAX_PASSPORT_TTL_SECONDS = 60;

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
      x:
        Math.floor(this.now() / 1000) +
        Math.min(ttlSeconds, MAX_PASSPORT_TTL_SECONDS),
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
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, "base64url");
    } catch {
      return { ok: false, reason: "malformed" };
    }
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
    if (Math.floor(this.now() / 1000) >= payload.x) {
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
