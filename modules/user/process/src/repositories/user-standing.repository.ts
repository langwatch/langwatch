import type { UserStandingFact } from "../rules/user-standing.rules.ts";

/** User's own deactivated and reactivated facts, read from its lifecycle log. */
export abstract class UserStandingRepository {
  /** Each account's deactivated and reactivated facts, oldest first, read for a whole page. */
  abstract findStandingFactsOf(input: {
    userIds: readonly string[];
  }): Promise<{ userId: string; facts: UserStandingFact[] }[]>;
}
