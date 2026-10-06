import type { OwnEventStore } from "@langwatch/eventing";
import {
  IDENTITY_EVENT_TYPES,
  type IdentityHistoryEntry,
  type LinkProposalRecord,
  MFA_EVENT_TYPES,
} from "@langwatch/identity-contract";

import type { IdentityEvent } from "../../eventing/identity-state.projection.ts";
import { identityHistoryEntries, linkProposalsOf } from "../../rules/identity-history.rules.ts";
import { IdentityHistoryRepository } from "../identity-history.repository.ts";

/** The one read this repository takes off the user_identity pipeline's own store. */
type IdentityEventReads = Pick<OwnEventStore, "read">;

/** Every fact the user_identity aggregate states: the MFA facts share it and the panel. */
const USER_IDENTITY_EVENT_TYPE_SET: ReadonlySet<unknown> = new Set([
  ...IDENTITY_EVENT_TYPES,
  ...MFA_EVENT_TYPES,
]);

/**
 * The identity log itself, read through the user_identity pipeline's own store: the history
 * panel and the proposals are both folds of the same scan.
 */
export class EventingIdentityHistoryRepository extends IdentityHistoryRepository {
  static create(deps: { eventStore: IdentityEventReads }): EventingIdentityHistoryRepository {
    return new EventingIdentityHistoryRepository(deps.eventStore);
  }

  private constructor(private readonly eventStore: IdentityEventReads) {
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
    return this.eventStore.read({
      tenantId: userId,
      aggregateId: userId,
      accepts: isUserIdentityEvent,
    });
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
