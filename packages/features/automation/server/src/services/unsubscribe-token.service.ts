import { createHmac, timingSafeEqual } from "node:crypto";
import type { UnsubscribeTokenPayload } from "../ports/unsubscribe-token.port";

/**
 * The signed unsubscribe token (ADR-031), as both halves of one format.
 *
 * Every automation email carries a per-recipient footer link whose token
 * encodes `{projectId, triggerId, email}` and an HMAC over those fields. The
 * public `/unsubscribe` route verifies it without a login, so the token IS the
 * authorization: it cannot be altered to unsubscribe a different address (the
 * HMAC covers the email) and it cannot be forged without the key.
 *
 * ## Why it is here and not in the process that sends
 *
 * It is a WIRE FORMAT, not a utility, and the two ends are different
 * processes. A link minted by a background worker's mail is verified by the
 * application's route, months later, out of somebody's inbox. Signing and
 * verifying therefore live in one module in the feature that owns the
 * semantics, exactly as the stored-secret cipher does
 * (`AesGcmSecretEncryptionAdapter`), rather than once per composition root.
 *
 * The application keeps its own copy at
 * `platform/app/src/server/mailer/unsubscribeToken.ts`. Neither description is
 * free to drift while both exist: this suite pins the recorded bytes of a
 * token the other module signed.
 *
 * ## Where the key comes from
 *
 * Nowhere in here. Each process reads its own environment and hands the key
 * in, which is what makes the empty-key refusal exercisable without mutating a
 * process. The application reads `NEXTAUTH_SECRET`; so does the worker's
 * projection, spelling for spelling.
 *
 * decide(ADR-031): tokens carry no expiry and no version field, so they are
 * replayable forever and cannot be rotated without invalidating every footer
 * link already in inboxes. This is intentional. The blast radius of a leaked
 * token is bounded to the single HMAC-bound recipient address it encodes —
 * replaying it only (re-)suppresses that recipient's own mail, which they
 * could do from the footer anyway. Rotating the signing key invalidates all
 * tokens at once, which is the deliberate kill switch.
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
  tryVerify(token: string): UnsubscribeTokenPayload | null {
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
 * The signed shape, field order included.
 *
 * The HMAC covers `JSON.stringify` of this object, so the ORDER of the three
 * keys is part of the format: re-ordering them changes every signature and
 * silently invalidates every link already in an inbox.
 */
function normalize(payload: UnsubscribeTokenPayload): UnsubscribeTokenPayload {
  return {
    projectId: payload.projectId,
    triggerId: payload.triggerId ?? null,
    email: payload.email.trim().toLowerCase(),
  };
}
