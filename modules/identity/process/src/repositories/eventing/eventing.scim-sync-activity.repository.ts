import { type EventStore, createTenantId } from "@langwatch/eventing";
import {
  SCIM_SYNC_AGGREGATE_TYPE,
  type ScimSyncActivityEntry,
  scimSyncIdFor,
} from "@langwatch/identity-contract";

import type { ScimSyncEvent } from "../../eventing/scim-sync-state.projection.ts";
import { scimSyncActivityOutcome } from "../../rules/scim-sync-activity.rules.ts";
import { ScimSyncActivityRepository } from "../scim-sync-activity.repository.ts";

/** The one read this repository takes off the store. */
export type ScimSyncEventReads = Pick<EventStore<ScimSyncEvent>, "getEvents">;

/**
 * The directory-sync log itself, read through this process's event store.
 * Every scim_sync payload carries ids, enums and counts only (ADR-101 §4).
 */
export class EventingScimSyncActivityRepository extends ScimSyncActivityRepository {
  static create(deps: {
    eventStore: () => Promise<ScimSyncEventReads>;
  }): EventingScimSyncActivityRepository {
    return new EventingScimSyncActivityRepository(deps.eventStore);
  }

  private constructor(private readonly eventStore: () => Promise<ScimSyncEventReads>) {
    super();
  }

  async findActivity({
    organizationId,
    connectionId,
    limit,
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly ScimSyncActivityEntry[]> {
    const store = await this.eventStore();
    const events = await store.getEvents(
      scimSyncIdFor({ connectionId }),
      { tenantId: createTenantId(organizationId) },
      SCIM_SYNC_AGGREGATE_TYPE,
    );
    return events.map(toActivityEntry).toSorted(newestFirst).slice(0, limit);
  }
}

/** Read structurally: every fact carries a subset of the fields the activity words. */
function toActivityEntry(event: ScimSyncEvent): ScimSyncActivityEntry {
  const { userId, externalId, groupId, op, errorCode }: Readonly<Record<string, unknown>> =
    event.data;
  const read = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  return {
    eventId: event.id,
    type: event.type,
    occurredAtMs: event.occurredAt,
    outcome: scimSyncActivityOutcome(event.type),
    userId: read(userId),
    externalId: read(externalId),
    groupId: read(groupId),
    op: read(op),
    errorCode: read(errorCode),
  };
}

/** Newest first, with the event id breaking a tie so every pod agrees. */
function newestFirst(a: ScimSyncActivityEntry, b: ScimSyncActivityEntry): number {
  if (b.occurredAtMs !== a.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
  return b.eventId.localeCompare(a.eventId);
}
