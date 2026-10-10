import {
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_EVENT_TYPES,
  type ScimSyncActivityEntry,
  scimSyncIdFor,
} from "@langwatch/enterprise-scim-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createTenantId, type EventReadSeat } from "@langwatch/eventing";

import type { ScimSyncEvent } from "../../eventing/scim-sync-state.projection.ts";
import { scimSyncActivityOutcome } from "../../rules/scim-sync-activity.rules.ts";
import { ScimSyncActivityRepository } from "../scim-sync-activity.repository.ts";

/** The one read this repository takes off eventing's read seat. */
type ScimSyncEventReads = Pick<EventReadSeat, "getEvents">;

const SCIM_SYNC_EVENT_TYPE_SET: ReadonlySet<unknown> = new Set(SCIM_SYNC_EVENT_TYPES);

/**
 * The directory-sync log itself, read through eventing's read seat, which answers in a process
 * that only sends commands too. Every scim_sync payload carries ids, enums and counts only
 * (ADR-101 §4).
 */
export class EventingScimSyncActivityRepository extends ScimSyncActivityRepository {
  static create(deps: { eventReadSeat: ScimSyncEventReads }): EventingScimSyncActivityRepository {
    return new EventingScimSyncActivityRepository(deps.eventReadSeat);
  }

  private constructor(private readonly eventReadSeat: ScimSyncEventReads) {
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
    const events: readonly unknown[] = await this.eventReadSeat.getEvents({
      tenantId: createTenantId(organizationId),
      aggregateType: SCIM_SYNC_AGGREGATE_TYPE,
      aggregateId: scimSyncIdFor({ connectionId }),
    });
    return events
      .filter(isScimSyncEvent)
      .map(toActivityEntry)
      .toSorted(newestFirst)
      .slice(0, limit);
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
