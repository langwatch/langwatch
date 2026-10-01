import { createHmac, timingSafeEqual } from "node:crypto";

export type UnsubscribeTokenPayload = {
  projectId: string;
  triggerId: string | null;
  email: string;
};

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
  }): UnsubscribeTokenService {
    return new UnsubscribeTokenService(input.secret);
  }

  private constructor(private readonly secret: string | undefined) {}

  /** Wire format: `base64url(JSON payload) + "." + hex(HMAC of the payload)`. */
  sign(payload: UnsubscribeTokenPayload): string {
    const serialized = JSON.stringify(normalize(payload));
    const encoded = Buffer.from(serialized).toString("base64url");

    return `${encoded}.${this.signature(serialized)}`;
  }

  /** The payload a well-formed, correctly signed token carries, or nothing. */
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

    const { projectId, triggerId, email } = parsed as Record<string, unknown>;
    if (typeof projectId !== "string" || typeof email !== "string") {
      return null;
    }

    if (triggerId !== null && typeof triggerId !== "string") {
      return null;
    }

    // Normalized on the way out too, so a caller reads the same address the
    // signer bound regardless of how the token was cased.
    return normalize({ projectId, triggerId, email });
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
 * The signed shape, field order included: the HMAC covers
 * `JSON.stringify` of this object, so reordering these three keys
 * changes every signature and invalidates every link already in an inbox.
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
  static create(input: { secret: string | undefined }): HmacUnsubscribeTokenAdapter {
    return new HmacUnsubscribeTokenAdapter(UnsubscribeTokenService.create(input));
  }

  private constructor(private readonly tokens: UnsubscribeTokenService) {
    super();
  }

  findVerifiedPayload(token: string): UnsubscribeTokenPayload | null {
    return this.tokens.findVerifiedPayload(token);
  }
}
