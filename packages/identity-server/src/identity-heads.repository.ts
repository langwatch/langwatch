import type {
  IdentifierFact,
  IdentityHeads,
} from "@langwatch/identity";

/**
 * How the guards and the ceremonies see current state: reads over the
 * `Identifier` projection and `User.userHashKey`. The app implements this
 * with Prisma
 * (platform/app/src/server/app-layer/identity/repositories/identity-heads.prisma.repository.ts).
 *
 * On the calling-path dispatch these reads are read-your-writes against
 * Postgres; on the staged path they run under the queue's per-user FIFO,
 * which serializes them against the fold. Either way a guard reads the
 * heads first and states only what they do not carry (PR #7429).
 */
export interface IdentityHeadsRepository {
  /** The per-user HMAC key (`User.userHashKey`); null when not yet minted —
   *  the attach then records a null hash rather than failing the ceremony. */
  findUserHashKey(args: { userId: string }): Promise<string | null>;
  /** The user's current identifier heads, as the projection knows them. */
  findHeads(args: { userId: string }): Promise<IdentityHeads>;
  /** An ACTIVE (VERIFIED or PRIMARY) identifier holding this normalized
   *  value, whoever holds it — the cross-user uniqueness guard's read. */
  findActiveIdentifierByValue(args: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string } | null>;
  /** One head of this user's, or null — the verification mint's guard. */
  findIdentifier(args: {
    userId: string;
    identifierId: string;
  }): Promise<IdentifierFact | null>;
  /**
   * The identifier a protocol `Account` row mirrors: by accountId first. A
   * row adopted before the projection carried accountIds falls back to the
   * user's live identifiers on the same provider — used only when that
   * names exactly ONE identifier; two or more is ambiguous and answers null
   * rather than a guess; so does no match.
   *
   * The fallback keys on better-auth's OWN `providerId`, never the folded
   * `provider` vocabulary. Folding collapses auth0, okta and every custom
   * OIDC connection into `oidc`, so a user holding one live identifier under
   * that bucket and unlinking a DIFFERENT enterprise account matched the one
   * they still use and detached it — losing them a working sign-in. Keying on
   * the verbatim id makes the fallback strictly narrower: an identifier the
   * backfill adopted carries it, so the historical rows this exists for are
   * still found.
   */
  findIdentifierIdForAccount(args: {
    userId: string;
    accountId: string;
    providerId: string;
  }): Promise<string | null>;
}
