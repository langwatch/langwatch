import { createTenantId, type EventReadSeat } from "@langwatch/eventing";
import {
  IDENTITY_EVENT_TYPES,
  type IdentityHistoryEntry,
  type LinkProposalRecord,
  MFA_EVENT_TYPES,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";

import type { IdentityEvent } from "../../eventing/identity-state.projection.ts";
import { identityHistoryEntries, linkProposalsOf } from "../../rules/identity-history.rules.ts";
import { IdentityHistoryRepository } from "../identity-history.repository.ts";

/** The one read this repository takes off eventing's read seat. */
type IdentityEventReads = Pick<EventReadSeat, "getEvents">;

/** Every fact the user_identity aggregate states: the MFA facts share it and the panel. */
const USER_IDENTITY_EVENT_TYPE_SET: ReadonlySet<unknown> = new Set([
  ...IDENTITY_EVENT_TYPES,
  ...MFA_EVENT_TYPES,
]);

/**
 * The identity log itself, read through eventing's read seat, which answers in a process that
 * only sends commands too: the history panel and the proposals are both folds of the same scan.
 */
export class EventingIdentityHistoryRepository extends IdentityHistoryRepository {
  static create(deps: { eventReadSeat: IdentityEventReads }): EventingIdentityHistoryRepository {
    return new EventingIdentityHistoryRepository(deps.eventReadSeat);
  }

  private constructor(private readonly eventReadSeat: IdentityEventReads) {
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

  /** A person's identity facts live in their own tenant, on the aggregate named after them. */
  private async readEvents({ userId }: { userId: string }): Promise<readonly IdentityEvent[]> {
    const events: readonly unknown[] = await this.eventReadSeat.getEvents({
      tenantId: createTenantId(userId),
      aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
      aggregateId: userId,
    });
    return events.filter(isUserIdentityEvent);
  }
}

/** Typed as the identity union the history rules read structurally, as the log always was. */
function isUserIdentityEvent(event: unknown): event is IdentityEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    USER_IDENTITY_EVENT_TYPE_SET.has(event.type)
  );
}
