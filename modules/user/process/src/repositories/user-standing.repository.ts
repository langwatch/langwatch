import type { UserStandingFact } from "../rules/user-standing.rules.ts";

/** User's own deactivated and reactivated facts, read from its lifecycle log. */
export abstract class UserStandingRepository {
  /** The account's deactivated and reactivated facts, oldest first. */
  abstract findStandingFacts(input: { userId: string }): Promise<UserStandingFact[]>;
}
