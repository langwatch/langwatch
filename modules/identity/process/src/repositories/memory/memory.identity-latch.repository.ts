import { IdentityLatchRepository } from "../identity-latch.repository.ts";
import { MemoryIdentityStore } from "./memory-identity.store.ts";

/** The latch twin: a set of finalized user ids, seeded directly by tests. */
export class MemoryIdentityLatchRepository extends IdentityLatchRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityLatchRepository {
    return new MemoryIdentityLatchRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async hasAnyoneFinalized(): Promise<boolean> {
    return this.store.finalizedUsers.size > 0;
  }

  async isFinalized(args: { userId: string }): Promise<boolean> {
    return this.store.finalizedUsers.has(args.userId);
  }
}
