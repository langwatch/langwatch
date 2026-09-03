/**
 * The verification ceremony's row-truth record (D01): pinned at mint to
 * exactly one (verificationId, identifierId, userId), hashed token, S256
 * challenge, TTL. The app stores it on the better-auth Verification
 * protocol table
 * (platform/app/src/server/app-layer/identity/repositories/identity-verification.prisma.repository.ts);
 * the events carry only `verificationId` and `method` — the token and the
 * verifier never appear in any fact (the payload rule).
 */
export interface IdentityVerificationRecord {
  verificationId: string;
  userId: string;
  identifierId: string;
  /** SHA-256 hex of the emailed token — the raw token is never at rest. */
  tokenHash: string;
  /** The initiating context's S256 PKCE challenge, bound at mint. */
  codeChallenge: string;
  expiresAtMs: number;
}

export interface IdentityVerificationRepository {
  /** Minting replaces any prior record for the same identifier — a newer
   *  mint invalidates every older link. */
  replaceForIdentifier(record: IdentityVerificationRecord): Promise<void>;
  tryFindByIdentifierId(args: {
    identifierId: string;
  }): Promise<IdentityVerificationRecord | null>;
  /** Deletes the record if and only if it still names this verification;
   *  false means already consumed (or superseded) — single-use enforcement. */
  consume(args: { identifierId: string; verificationId: string }): Promise<boolean>;
}
