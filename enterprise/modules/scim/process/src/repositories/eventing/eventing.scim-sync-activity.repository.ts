import {
  SCIM_SYNC_EVENT_TYPES,
  type ScimSyncActivityEntry,
  scimSyncIdFor,
} from "@langwatch/enterprise-scim-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OwnEventStore } from "@langwatch/eventing";

import type { ScimSyncEvent } from "../../eventing/scim-sync-state.projection.ts";
import { scimSyncActivityOutcome } from "../../rules/scim-sync-activity.rules.ts";
import { ScimSyncActivityRepository } from "../scim-sync-activity.repository.ts";

/** The one read this repository takes off the scim_sync pipeline's own store. */
export type ScimSyncEventReads = Pick<OwnEventStore, "read">;

const SCIM_SYNC_EVENT_TYPE_SET: ReadonlySet<unknown> = new Set(SCIM_SYNC_EVENT_TYPES);

/**
 * The directory-sync log itself, read through the scim_sync pipeline's own event store.
 * Every scim_sync payload carries ids, enums and counts only (ADR-101 §4).
 */
export class EventingScimSyncActivityRepository extends ScimSyncActivityRepository {
  static create(deps: { eventStore: ScimSyncEventReads }): EventingScimSyncActivityRepository {
    return new EventingScimSyncActivityRepository(deps.eventStore);
  }

  private constructor(private readonly eventStore: ScimSyncEventReads) {
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
    const events = await this.eventStore.read({
      tenantId: organizationId,
      aggregateId: scimSyncIdFor({ connectionId }),
      accepts: isScimSyncEvent,
    });
    return events.map(toActivityEntry).toSorted(newestFirst).slice(0, limit);
  }
}

/** One of the eight facts the scim_sync pipeline declares. */
function isScimSyncEvent(event: unknown): event is ScimSyncEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    SCIM_SYNC_EVENT_TYPE_SET.has(event.type)
  );
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
