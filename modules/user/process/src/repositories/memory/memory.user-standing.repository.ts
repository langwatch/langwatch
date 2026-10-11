import type { UserStandingFact } from "../../rules/user-standing.rules.ts";
import { UserStandingRepository } from "../user-standing.repository.ts";

/** An account's standing facts over what a test hands it; a fresh one holds none. */
export class MemoryUserStandingRepository extends UserStandingRepository {
  static create(): MemoryUserStandingRepository {
    return new MemoryUserStandingRepository();
  }

  readonly #held = new Map<string, UserStandingFact[]>();

  private constructor() {
    super();
  }

  add({ userId, fact }: { userId: string; fact: UserStandingFact }): void {
    this.#held.set(userId, [...(this.#held.get(userId) ?? []), fact]);
  }

  async findStandingFacts({ userId }: { userId: string }): Promise<UserStandingFact[]> {
    return [...(this.#held.get(userId) ?? [])];
  }
}
