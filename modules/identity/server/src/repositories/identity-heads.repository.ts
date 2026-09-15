import type { IdentifierFact, IdentityHeads } from "@langwatch/identity-contract";

/**
 * How the guards and the ceremonies see current state: reads over the
 * `Identifier` projection and `User.userHashKey`. Either the calling-path
 * (read-your-writes against Postgres) or the staged path (serialized by the
 * queue's per-user FIFO against the fold), a guard reads the heads first
 * and states only what they do not carry (PR #7429).
 */
export abstract class IdentityHeadsRepository {
  /** The per-user HMAC key (`User.userHashKey`); null when not yet minted —
   *  the attach then records a null hash rather than failing the ceremony. */
  abstract tryFindUserHashKey(args: { userId: string }): Promise<string | null>;
  /** The user's current identifier heads, as the projection knows them. */
  abstract findHeads(args: { userId: string }): Promise<IdentityHeads>;
  /**
   * Whether this user's projection has folded at least once — a cursor row
   * exists. Until it has, the heads may hold PROVISIONAL rows the ledger wrote
   * for a newborn before staging, and those are not event truth: the attach
   * guard dedupes against folded heads only, so the queued run still states
   * the fact the row anticipates.
   */
  abstract hasFolded(args: { userId: string }): Promise<boolean>;
  /** An ACTIVE (VERIFIED or PRIMARY) identifier holding this normalized
   *  value, whoever holds it — the cross-user uniqueness guard's read. */
  abstract tryFindActiveIdentifierByValue(args: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string } | null>;
  /** One head of this user's, or null — the verification mint's guard. */
  abstract tryFindIdentifier(args: {
    userId: string;
    identifierId: string;
  }): Promise<IdentifierFact | null>;
  /**
   * The identifier a protocol `Account` row mirrors, by accountId first. The
   * fallback keys on better-auth's own `providerId`, never the folded
   * `provider` vocabulary — keying on the fold once matched and detached the
   * wrong enterprise account, since it collapses every OIDC connection into `oidc`.
   */
  abstract tryFindIdentifierIdForAccount(args: {
    userId: string;
    accountId: string;
    providerId: string;
  }): Promise<string | null>;
}

/**
 * The one read the `User.email` fork makes. Named apart from the full
 * repository since the fork needs only a user's heads, not the uniqueness
 * lookups and account mirror the guards and ceremonies need.
 */
export type IdentityHeadsReader = Pick<IdentityHeadsRepository, "findHeads">;
