import type { UserStandingFact } from "../../rules/user-standing.rules.ts";
import { UserStandingRepository } from "../user-standing.repository.ts";

/** A memory tier's lifecycle log holds no standing fact: every account reads an empty history. */
export class MemoryUserStandingRepository extends UserStandingRepository {
  static create(): MemoryUserStandingRepository {
    return new MemoryUserStandingRepository();
  }

  private constructor() {
    super();
  }

  async findStandingFactsOf({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<{ userId: string; facts: UserStandingFact[] }[]> {
    return userIds.map((userId) => ({ userId, facts: [] }));
  }
}
