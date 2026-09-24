import type { IdentifierFact, IdentityHeads } from "@langwatch/identity-contract";

/**
 * How the guards and the ceremonies see current state: reads over the
 * `Identifier` projection and `User.userHashKey`. A guard reads the heads
 * first and states only what they do not carry (PR #7429).
 */
export abstract class IdentityHeadsRepository {
  /** The user row's HMAC key (`User.userHashKey`), null inside until minted; the attach
   *  then records a null hash. `UserNotFoundError` when no user carries this id. */
  abstract getUserHashKey(args: { userId: string }): Promise<{ userHashKey: string | null }>;
  /** The user's current identifier heads, as the projection knows them. */
  abstract findHeads(args: { userId: string }): Promise<IdentityHeads>;
  /**
   * Whether this user's projection has folded at least once. Until it has,
   * heads may hold PROVISIONAL rows that are not event truth — the attach
   * guard dedupes against folded heads only.
   */
  abstract hasFolded(args: { userId: string }): Promise<boolean>;
  /** An ACTIVE (VERIFIED or PRIMARY) identifier holding this normalized
   *  value, whoever holds it — the cross-user uniqueness guard's read.
   *  `IdentityIdentifierNotFoundError` when nobody holds it. */
  abstract getActiveIdentifierByValue(args: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string }>;
  /** One head of this user's — the verification mint's guard. */
  abstract getIdentifier(args: { userId: string; identifierId: string }): Promise<IdentifierFact>;
  /**
   * The identifier a protocol `Account` row mirrors, by accountId first.
   * Falls back to `providerId`, never the folded `provider` vocabulary,
   * which collapses every OIDC connection into `oidc`. Not found when ambiguous.
   */
  abstract getIdentifierIdForAccount(args: {
    userId: string;
    accountId: string;
    providerId: string;
  }): Promise<string>;
}

/**
 * The one read the `User.email` fork makes. Named apart from the full
 * repository since the fork needs only a user's heads, not the uniqueness
 * lookups and account mirror the guards and ceremonies need.
 */
export type IdentityHeadsReader = Pick<IdentityHeadsRepository, "findHeads">;
