import { createHmac, timingSafeEqual } from "node:crypto";

import { nowInstant, Temporal, type Instant } from "@langwatch/time";

export type UnsubscribeTokenPayload = {
  projectId: string;
  triggerId: string | null;
  email: string;
};

/** How long a footer link keeps working after it is minted. */
const LINK_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

/** Links minted before links carried an expiry stop working at this instant. */
const UNDATED_LINKS_EXPIRE_AT = Temporal.Instant.from("2027-04-01T00:00:00Z");

type Clock = Readonly<{ now(): Instant }>;

export abstract class UnsubscribeTokenVerifier {
  abstract findVerifiedPayload(token: string): UnsubscribeTokenPayload | null;
}

/**
 * Signed unsubscribe token wire format (ADR-031) shared between worker and app:
 * HMAC protects against forgery and alteration of projectId/triggerId/email.
 */
export class UnsubscribeTokenService {
  static create(input: {
    /** Injected signing key; empty or absent fails closed on both sides. */
    secret: string | undefined;
    clock?: Clock;
  }): UnsubscribeTokenService {
    return new UnsubscribeTokenService(input.secret, input.clock ?? { now: nowInstant });
  }

  private constructor(
    private readonly secret: string | undefined,
    private readonly clock: Clock,
  ) {}

  /**
   * Wire format: `base64url(JSON payload) + "." + hex(HMAC of the payload)`;
   * `exp` is epoch seconds.
   */
  sign(payload: UnsubscribeTokenPayload): string {
    const exp = Math.floor(this.clock.now().epochMilliseconds / 1000) + LINK_LIFETIME_SECONDS;
    const serialized = JSON.stringify({ ...normalize(payload), exp });
    const encoded = Buffer.from(serialized).toString("base64url");

    return `${encoded}.${this.signature(serialized)}`;
  }

  /** The payload a well-formed, correctly signed, unexpired token carries, or nothing. */
  findVerifiedPayload(token: string): UnsubscribeTokenPayload | null {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) {
      return null;
    }

    const encoded = token.slice(0, dot);
    const providedSignature = token.slice(dot + 1);

    let serialized: string;
    try {
      serialized = Buffer.from(encoded, "base64url").toString("utf8");
    } catch {
      return null;
    }

    // Constant-time compare, after a length check: `timingSafeEqual` throws on
    // mismatched buffer lengths.
    const provided = Buffer.from(providedSignature);
    const expected = Buffer.from(this.signature(serialized));
    if (provided.length !== expected.length) {
      return null;
    }

    if (!timingSafeEqual(new Uint8Array(provided), new Uint8Array(expected))) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const { projectId, triggerId, email, exp } = parsed as Record<string, unknown>;
    if (typeof projectId !== "string" || typeof email !== "string") {
      return null;
    }

    if (!this.isLive(exp)) {
      return null;
    }

    if (triggerId !== null && typeof triggerId !== "string") {
      return null;
    }

    // Normalized on the way out too, so a caller reads the same address the
    // signer bound regardless of how the token was cased.
    return normalize({ projectId, triggerId, email });
  }

  /** A dated link lives until its `exp`; an undated one until the fixed cut-off. */
  private isLive(exp: unknown): boolean {
    const now = this.clock.now().epochMilliseconds;
    if (exp === undefined) {
      return now < UNDATED_LINKS_EXPIRE_AT.epochMilliseconds;
    }

    return typeof exp === "number" && now < exp * 1000;
  }

  private signature(serialized: string): string {
    if (!this.secret) {
      // An empty key makes tokens forgeable — anyone could mint a valid
      // unsubscribe link for any address. Fail closed rather than sign or
      // verify with one.
      throw new Error(
        "NEXTAUTH_SECRET is not set; refusing to sign/verify unsubscribe tokens with an empty key.",
      );
    }

    return createHmac("sha256", this.secret).update(serialized).digest("hex");
  }
}

/**
 * The signed shape, field order included: the HMAC covers `JSON.stringify`
 * of this object (then `exp`), so reordering these keys changes every
 * signature and invalidates every link already in an inbox.
 */
function normalize(payload: UnsubscribeTokenPayload): UnsubscribeTokenPayload {
  return {
    projectId: payload.projectId,
    triggerId: payload.triggerId ?? null,
    email: payload.email.trim().toLowerCase(),
  };
}

/**
 * The verifier every process composes over the one token format, so a
 * composition root supplies only a key -- the format itself is the
 * feature's (`UnsubscribeTokenService`), never re-implemented per root.
 */
export class HmacUnsubscribeTokenAdapter extends UnsubscribeTokenVerifier {
  static create(input: { secret: string | undefined; clock?: Clock }): HmacUnsubscribeTokenAdapter {
    return new HmacUnsubscribeTokenAdapter(UnsubscribeTokenService.create(input));
  }

  private constructor(private readonly tokens: UnsubscribeTokenService) {
    super();
  }

  findVerifiedPayload(token: string): UnsubscribeTokenPayload | null {
    return this.tokens.findVerifiedPayload(token);
  }
}
