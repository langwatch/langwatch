import type { Instant } from "@langwatch/time";

/**
 * Who authz treats as gone, folded from user's deactivation facts and identity's erasure
 * (ARCHITECTURE.md, "Platform operators are a grant"); authz never reads the User table.
 * Every write is idempotent: a fact older than the one already applied changes nothing.
 */
export abstract class AuthzUserStandingRepository {
  abstract recordDeactivated(input: { userId: string; at: Instant }): Promise<void>;
  abstract recordReactivated(input: { userId: string; at: Instant }): Promise<void>;
  /** Erasure is final: no later reactivation restores the user. */
  abstract recordErased(input: { userId: string; at: Instant }): Promise<void>;
  /** The users among these who are deactivated or erased. */
  abstract findInactiveUserIds(input: { userIds: readonly string[] }): Promise<string[]>;
}
