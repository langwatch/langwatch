import { type EventStore, createTenantId } from "@langwatch/eventing";
import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  type IdentityActor,
  type IdentityHistoryEntry,
  LINK_PROPOSED_EVENT_TYPE,
  type LinkProposalRecord,
  USER_IDENTITY_AGGREGATE_TYPE,
  identityActorSchema,
} from "@langwatch/identity-contract";

import type { IdentityEvent } from "../../eventing/identity-state.projection.ts";
import { IdentityHistoryRepository } from "../identity-history.repository.ts";

/** Fields the identity payloads carry, read structurally rather than per type. */
interface IdentityPayloadShape {
  identifierId?: unknown;
  provider?: unknown;
  value?: unknown;
  domain?: unknown;
  connectionId?: unknown;
  proposalId?: unknown;
  actor?: unknown;
}

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
    const events = await this.readEvents({ userId });
    return events.map(toHistoryEntry).toSorted(newestFirst).slice(0, limit);
  }

  async findProposals({ userId }: { userId: string }): Promise<readonly LinkProposalRecord[]> {
    const events = await this.readEvents({ userId });
    return events
      .flatMap((event) =>
        event.type === LINK_PROPOSED_EVENT_TYPE
          ? [
              {
                proposalId: event.data.proposalId,
                userId,
                connectionId: event.data.connectionId,
                provider: event.data.provider,
                providerAccountId: event.data.providerAccountId,
                value: event.data.value,
                domain: event.data.domain,
                reason: event.data.reason,
                proposedAtMs: event.occurredAt,
                decision: null,
              },
            ]
          : [],
      )
      .toSorted((a, b) => b.proposedAtMs - a.proposedAtMs);
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

function extractText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function actorOf(value: unknown): IdentityActor {
  const parsed = identityActorSchema.safeParse(value);
  return parsed.success ? parsed.data : { type: "system", id: null };
}

/** The one enum each fact turns on, where it has one. */
function extractDetail(event: IdentityEvent): string | null {
  switch (event.type) {
    case IDENTIFIER_ATTACHED_EVENT_TYPE:
      return extractText(event.data.state);
    case IDENTIFIER_VERIFIED_EVENT_TYPE:
      return extractText(event.data.method);
    case IDENTIFIER_DEAD_ENDED_EVENT_TYPE:
      return extractText(event.data.reason);
    case LINK_PROPOSED_EVENT_TYPE:
      return extractText(event.data.reason);
    default:
      return null;
  }
}

function toHistoryEntry(event: IdentityEvent): IdentityHistoryEntry {
  const data: IdentityPayloadShape = event.data;
  return {
    eventId: event.id,
    type: event.type,
    occurredAtMs: event.occurredAt,
    actor: actorOf(data.actor),
    identifierId: extractText(data.identifierId),
    provider: extractText(data.provider),
    value: extractText(data.value),
    domain: extractText(data.domain),
    connectionId: extractText(data.connectionId),
    proposalId: extractText(data.proposalId),
    detail: extractDetail(event),
  };
}

/** Newest first, with the event id breaking a tie so every pod agrees. */
function newestFirst(a: IdentityHistoryEntry, b: IdentityHistoryEntry): number {
  if (b.occurredAtMs !== a.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
  return b.eventId.localeCompare(a.eventId);
}
