import { type EventSourcing, type EventStore, createTenantId } from "@langwatch/eventing";
import {
  type IdentityHistoryEntry,
  type LinkProposalRecord,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";

import type { IdentityEvent } from "../../eventing/identity-state.projection.ts";
import { identityHistoryEntries, linkProposalsOf } from "../../rules/identity-history.rules.ts";
import { IdentityHistoryRepository } from "../identity-history.repository.ts";

/**
 * The identity log itself, read through this process's event store: the
 * history panel and the proposals are both folds of the same scan. The store
 * is resolved per read, so a stack that is not up at boot still answers later.
 */
export class EventingIdentityHistoryRepository extends IdentityHistoryRepository {
  static create(deps: {
    eventing: Pick<EventSourcing, "getEventStore">;
  }): EventingIdentityHistoryRepository {
    return new EventingIdentityHistoryRepository(deps.eventing);
  }

  private constructor(private readonly eventing: Pick<EventSourcing, "getEventStore">) {
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
    const store: EventStore<IdentityEvent> | undefined =
      this.eventing.getEventStore<IdentityEvent>();
    if (!store) {
      throw new Error("identity history cannot read: the event-sourcing stack is unavailable");
    }
    return store.getEvents(
      userId,
      { tenantId: createTenantId(userId) },
      USER_IDENTITY_AGGREGATE_TYPE,
    );
  }
}
