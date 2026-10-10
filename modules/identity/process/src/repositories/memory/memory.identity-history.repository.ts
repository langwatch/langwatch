import type { IdentityHistoryEntry, LinkProposalRecord } from "@langwatch/identity-contract";

import { identityHistoryEntries, linkProposalsOf } from "../../rules/identity-history.rules.ts";
import { IdentityHistoryRepository } from "../identity-history.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/** The identity log's twin: the same folds, over the events the memory store holds. */
export class MemoryIdentityHistoryRepository extends IdentityHistoryRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityHistoryRepository {
    return new MemoryIdentityHistoryRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async findHistory({
    userId,
    limit,
  }: {
    userId: string;
    limit: number;
  }): Promise<readonly IdentityHistoryEntry[]> {
    return identityHistoryEntries({ events: this.store.findIdentityEvents({ userId }), limit });
  }

  async findProposals({ userId }: { userId: string }): Promise<readonly LinkProposalRecord[]> {
    return linkProposalsOf({ userId, events: this.store.findIdentityEvents({ userId }) });
  }
}
