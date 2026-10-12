/**
 * The verification ceremony's row-truth record (D01): hashed token, S256
 * challenge, TTL, pinned at mint. Events carry only `verificationId` and
 * `method` — the token and verifier never appear in any fact (payload rule).
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

export abstract class IdentityVerificationRepository {
  /** Minting replaces any prior record for the same identifier — a newer
   *  mint invalidates every older link. */
  abstract replaceForIdentifier(record: IdentityVerificationRecord): Promise<void>;
  /** The newest record; `IdentityVerificationInvalidError` when no ceremony is in flight, since
   *  every pin/proof failure answers that one code. */
  abstract getByIdentifierId(args: { identifierId: string }): Promise<IdentityVerificationRecord>;
  /** Deletes the record if and only if it still names this verification;
   *  false means already consumed (or superseded) — single-use enforcement. */
  abstract consume(args: { identifierId: string; verificationId: string }): Promise<boolean>;
}
