import type { Instant } from "@langwatch/time";

import { IdentityLatchRepository } from "../identity-latch.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

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

  async recordFinalized(args: { userId: string; report: unknown }): Promise<void> {
    if (this.store.pinnedUsers.has(args.userId)) return;
    this.store.finalizedUsers.add(args.userId);
  }

  async recordProven(args: { userId: string; at: Instant }): Promise<boolean> {
    if (this.store.pinnedUsers.has(args.userId)) return false;
    this.store.finalizedUsers.add(args.userId);
    return true;
  }

  async pinSignInSwitch(args: { userId: string; at: Instant; eventId: string }): Promise<void> {
    this.store.pinnedUsers.add(args.userId);
    this.store.finalizedUsers.delete(args.userId);
  }
}
