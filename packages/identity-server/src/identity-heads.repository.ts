import type {
  IdentifierFact,
  IdentifierProvider,
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
   */
  findIdentifierIdForAccount(args: {
    userId: string;
    accountId: string;
    provider: IdentifierProvider;
  }): Promise<string | null>;
  /**
   * The identifier an IdP callback names, whoever holds it (ADR-116): the
   * `(providerId, subject)` pair better-auth arrives with. Cross-user by
   * necessity — the whole question is which user this is — and live states
   * only, so a detached or dead-ended identifier can never sign anyone in.
   *
   * Null when nothing matches, which during migration means "not on identity
   * yet" and sends the caller to the legacy `Account` row.
   */
  findLiveIdentifierByProviderAccount(args: {
    provider: IdentifierProvider;
    providerAccountId: string;
  }): Promise<IdentifierFact | null>;
  /** The user's live identifiers — the account-list read (ADR-116). */
  findLiveIdentifiers(args: { userId: string }): Promise<IdentifierFact[]>;
  /**
   * One identifier by its own id, without knowing whose it is (ADR-116).
   * The credential row names an identifier and nothing else, so a read that
   * starts from a row id has no user to scope by yet — the user is what this
   * answers. Every caller then puts the user it learns through the gate.
   */
  findIdentifierById(args: {
    identifierId: string;
  }): Promise<IdentifierFact | null>;
}
