import { createHmac, hkdfSync } from "node:crypto";

import { canonicalizeEmailLike } from "@langwatch/identity-links";

import { env } from "~/env.mjs";

/**
 * Prefix on every erased-email token (ADR-094 Decision 9).
 *
 * It exists so a token is never mistaken for a real address — by a person
 * reading a link row, by a suggestion query comparing a member's email against
 * stored ids, or by a future import that assumes an `email`-kind value is
 * deliverable. It deliberately contains no `@`.
 */
export const ERASED_EMAIL_TOKEN_PREFIX = "erased:" as const;

export const isErasedEmailToken = (value: string): boolean =>
  value.startsWith(ERASED_EMAIL_TOKEN_PREFIX);

/**
 * HKDF `info` label. The `v1` is not an invitation to mint a v2 — see the key
 * rotation note on {@link IdentityErasureTokenService}. It is here so that if
 * this scheme is ever replaced wholesale, the replacement is visibly a
 * different scheme rather than the same one behaving differently.
 */
const HKDF_INFO_PREFIX = "langwatch:identity-links:erased-email:v1:";

/**
 * HKDF salt. Fixed and public: the per-organization separation comes from the
 * `info` label, and the master secret is the actual entropy.
 */
const HKDF_SALT = "langwatch:identity-links:erasure";

const ORGANIZATION_KEY_BYTES = 32;

/**
 * Derives the opaque token that replaces an email-shaped login id when a
 * person is erased (ADR-094 Decision 9, Constants "Erased-email token").
 *
 * The token is `HMAC-SHA256(organizationKey, canonicalEmail)` in hex behind
 * {@link ERASED_EMAIL_TOKEN_PREFIX}, where the organization key is HKDF-derived
 * from one instance-wide master secret. Deterministic on purpose: ClickHouse
 * keeps the raw provider events until their TTL expires, so at report time we
 * re-derive the same token from those raw emails and the erased person's
 * timeline keeps matching. A stored random token could not be re-derived, and
 * every erased person would silently fall out of "former member (erased)" and
 * into "unattributed" — changing published totals after the fact.
 *
 * THE KEY IS NOT ROTATABLE, and that is a property of the design rather than a
 * task nobody got to. Re-deriving an already-erased row's token would need the
 * email, which erasure destroyed. So a rotation could only ever orphan the rows
 * it was meant to protect. Two consequences we accept explicitly, both named in
 * the ADR: the key must be kept for as long as reports run, and anyone holding
 * both the key and a guessed address can confirm that address once existed in
 * the organization — the standard price of a pseudonymized join. That is why
 * the master secret belongs in the secret store with the narrowest access, and
 * never in the database beside the tokens it protects.
 */
export class IdentityErasureTokenService {
  private readonly organizationKeys = new Map<string, Buffer>();

  constructor(private readonly masterSecret: string) {
    if (masterSecret.length === 0) {
      throw new Error(
        "Identity erasure master secret is empty — set LW_IDENTITY_ERASURE_SECRET",
      );
    }
  }

  /**
   * Build from the environment. Throws when the secret is unset: erasure is
   * irreversible, and running it with a key we cannot reproduce would blank
   * the emails and leave tokens the report can never match again. Failing to
   * start is the recoverable outcome.
   */
  static fromEnv(): IdentityErasureTokenService {
    const service = IdentityErasureTokenService.fromEnvOrNull();
    if (!service) {
      throw new Error(
        "LW_IDENTITY_ERASURE_SECRET is not set — erasure and erased-timeline matching both need it",
      );
    }
    return service;
  }

  /**
   * For readers rather than erasers. The report wants the key so an erased
   * person keeps matching their own timeline, but a missing key must not take
   * the whole report down: an instance that has never erased anybody has
   * nothing to match, and one that has necessarily had the key set, because
   * {@link fromEnv} refuses without it. Callers log the degradation rather
   * than failing on it.
   */
  static fromEnvOrNull(): IdentityErasureTokenService | null {
    const secret = env.LW_IDENTITY_ERASURE_SECRET;
    return secret ? new IdentityErasureTokenService(secret) : null;
  }

  /**
   * The token for one raw email-shaped value. The caller may pass whatever the
   * provider spelled — canonicalization (trim + lowercase) happens here, so a
   * link row stored as `Alice@Example.com` and a ClickHouse row carrying
   * `alice@example.com` derive one token rather than two.
   */
  tokenFor({
    organizationId,
    email,
  }: {
    organizationId: string;
    email: string;
  }): string {
    const digest = createHmac("sha256", this.organizationKey(organizationId))
      .update(canonicalizeEmailLike(email), "utf8")
      .digest("hex");
    return `${ERASED_EMAIL_TOKEN_PREFIX}${digest}`;
  }

  /**
   * Tokens for many values at once, keyed by the RAW input so a caller can map
   * a stored `externalId` straight to its replacement. Values that are already
   * tokens are skipped: erasing a person twice must not hash the token of the
   * first pass into a second, unmatched one.
   */
  tokensFor({
    organizationId,
    emails,
  }: {
    organizationId: string;
    emails: readonly string[];
  }): Map<string, string> {
    const tokens = new Map<string, string>();
    for (const email of emails) {
      if (email === "" || isErasedEmailToken(email)) continue;
      tokens.set(email, this.tokenFor({ organizationId, email }));
    }
    return tokens;
  }

  /**
   * Per-organization key, HKDF-derived so one leaked organization key does not
   * hand over every other organization's oracle. Cached per instance because a
   * report derives a token for every email login in its window.
   */
  private organizationKey(organizationId: string): Buffer {
    const cached = this.organizationKeys.get(organizationId);
    if (cached) return cached;

    const key = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(this.masterSecret, "utf8"),
        Buffer.from(HKDF_SALT, "utf8"),
        Buffer.from(`${HKDF_INFO_PREFIX}${organizationId}`, "utf8"),
        ORGANIZATION_KEY_BYTES,
      ),
    );
    this.organizationKeys.set(organizationId, key);
    return key;
  }
}
