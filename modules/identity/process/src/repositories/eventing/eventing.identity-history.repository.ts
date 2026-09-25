import { type EventStore, createTenantId } from "@langwatch/eventing";
import {
  type IdentityHistoryEntry,
  type LinkProposalRecord,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";

import type { IdentityEvent } from "../../eventing/identity-state.projection.ts";
import { identityHistoryEntries, linkProposalsOf } from "../../rules/identity-history.rules.ts";
import { IdentityHistoryRepository } from "../identity-history.repository.ts";

/** The one read this repository takes off the store. */
export type IdentityEventReads = Pick<EventStore<IdentityEvent>, "getEvents">;

/**
 * The identity log itself, read through this process's event store: the
 * history panel and the proposals are both folds of the same scan.
 */
export class EventingIdentityHistoryRepository extends IdentityHistoryRepository {
  static create(deps: {
    eventStore: () => Promise<IdentityEventReads>;
  }): EventingIdentityHistoryRepository {
    return new EventingIdentityHistoryRepository(deps.eventStore);
  }

  private constructor(private readonly eventStore: () => Promise<IdentityEventReads>) {
    super();
  }

  async findHistory({
    userId,
    limit,
  }: {
    userId: string;
    limit: number;
  }): Promise<readonly IdentityHistoryEntry[]> {
    return identityHistoryEntries({ events: await this.readEvents({ userId }), limit });
  }

  async findProposals({ userId }: { userId: string }): Promise<readonly LinkProposalRecord[]> {
    return linkProposalsOf({ userId, events: await this.readEvents({ userId }) });
  }

  private async readEvents({ userId }: { userId: string }): Promise<readonly IdentityEvent[]> {
    const store = await this.eventStore();
    return store.getEvents(
      userId,
      { tenantId: createTenantId(userId) },
      USER_IDENTITY_AGGREGATE_TYPE,
    );
  }
}
