import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../../env.mjs";

/**
 * Signed, forge-proof unsubscribe tokens (ADR-031). Each trigger email carries
 * a per-recipient link whose token embeds `{projectId, triggerId, email}` and
 * an HMAC over those fields, keyed with NEXTAUTH_SECRET — the same keyed-hash
 * approach as `triggerNoReply.ts`. The public `/unsubscribe` route verifies the
 * token without a login, so the token IS the authorization: it cannot be
 * altered to unsubscribe a different address (the HMAC covers the email) and it
 * cannot be forged without the secret.
 *
 * Wire format: `base64url(JSON payload) + "." + hex(HMAC of the JSON payload)`.
 *
 * decide(ADR-031): tokens carry no expiry and no version field, so they are
 * replayable forever and cannot be rotated without invalidating every footer
 * link already in inboxes. This is intentional. The blast radius of a leaked
 * or replayed token is bounded to the single HMAC-bound recipient address it
 * encodes — replaying it only (re-)suppresses that recipient's own mail, which
 * they could do from the footer anyway; it cannot suppress a different address
 * (the HMAC covers the email) or escalate scope beyond the encoded
 * project/trigger. Adding an `exp` would 404 old links (the footer lives in
 * mail clients indefinitely) for no security gain, and a version field can't
 * be retrofitted onto already-minted tokens without breaking them. If a
 * compromise ever warrants mass rotation, rotating NEXTAUTH_SECRET invalidates
 * all tokens at once (the deliberate kill switch).
 */

export interface UnsubscribePayload {
  projectId: string;
  /** null = suppress every trigger in the project. */
  triggerId: string | null;
  /** Always lowercased before signing and on verify, so a link works
   *  regardless of the recipient address casing the author typed. */
  email: string;
}

function secret(): string {
  const value = env.NEXTAUTH_SECRET ?? "";
  if (!value) {
    // An empty secret makes tokens forgeable — anyone could mint a valid
    // unsubscribe link for any address. Fail closed rather than sign/verify
    // with an empty key.
    throw new Error(
      "NEXTAUTH_SECRET is not set; refusing to sign/verify unsubscribe tokens with an empty key.",
    );
  }
  return value;
}

function sign(serialized: string): string {
  return createHmac("sha256", secret()).update(serialized).digest("hex");
}

function normalize(payload: UnsubscribePayload): UnsubscribePayload {
  return {
    projectId: payload.projectId,
    triggerId: payload.triggerId ?? null,
    email: payload.email.trim().toLowerCase(),
  };
}

export function signUnsubscribeToken(payload: UnsubscribePayload): string {
  const normalized = normalize(payload);
  const serialized = JSON.stringify(normalized);
  const encoded = Buffer.from(serialized).toString("base64url");
  return `${encoded}.${sign(serialized)}`;
}

export function verifyUnsubscribeToken(
  token: string,
): UnsubscribePayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let serialized: string;
  try {
    serialized = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSig = sign(serialized);
  // Constant-time compare; bail before comparing if lengths differ since
  // timingSafeEqual throws on mismatched buffer lengths.
  const provided = Buffer.from(providedSig);
  const expected = Buffer.from(expectedSig);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { projectId, triggerId, email } = parsed as Record<string, unknown>;
  if (typeof projectId !== "string" || typeof email !== "string") return null;
  if (triggerId !== null && typeof triggerId !== "string") return null;
  // Normalize on verify too (matching the sign-side normalization) so the
  // returned email is always lowercased/trimmed regardless of token casing.
  return normalize({ projectId, triggerId, email });
}
