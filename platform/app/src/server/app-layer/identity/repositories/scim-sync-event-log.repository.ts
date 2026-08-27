/**
 * The directory-sync log, read as a sequence (ADR-126).
 *
 * ADR-122 said the organization view renders "projections AND the event log",
 * and shipped the projection half: a folded head saying where the connection
 * stands. This is the other half. The head answers "where does this stand";
 * somebody who configured a provider a minute ago is asking "did what I just
 * did arrive, and what did you make of it", and that question is a sequence.
 *
 * A read, and only a read. No new fact, no projection, nothing appended: the
 * pipeline already writes every one of these events, and this renders them.
 * That is also what makes the surface rebuildable for free — it shows nothing
 * the log cannot re-derive, because it IS the log.
 *
 * Tenancy is structural, like the identity log's. The scim_sync aggregate's
 * id is the connection and its tenant is the organization, so a read is one
 * tenant scan by construction: passing another organization's connection
 * reads that organization's tenant with this organization's id and finds
 * nothing, which is exactly how a connection that does not exist reads.
 *
 * The payload rule (ADR-101 §4) is what makes this safe to render without a
 * filter. Every scim_sync payload carries ids, enums and counts — never a
 * token, never a provider's raw message — so a reader that projects them
 * inherits no secret a future fact might have put there.
 */
import {
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncEventType,
  scimSyncIdFor,
} from "@langwatch/identity";
import { createTenantId } from "~/server/event-sourcing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { SCIM_SYNC_AGGREGATE_TYPE } from "~/server/event-sourcing/pipelines/scim-sync/schemas/constants";
import type { ScimSyncEvent } from "~/server/event-sourcing/pipelines/scim-sync/schemas/events";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import { resolveEventStore } from "../ledger";

/**
 * One thing the directory did, as an administrator reads it.
 *
 * Ids and enums only, for the same reason the identity history entry is ids
 * and enums: the words are assembled in the service, where the rest of this
 * surface's copy already lives, so the page has nothing of its own to drift
 * and the repository has no opinion about phrasing.
 */
export interface DirectoryActivityEntry {
  eventId: string;
  type: ScimSyncEventType;
  occurredAtMs: number;
  /** Whether this entry is something going right or something going wrong. */
  outcome: "ok" | "refused";
  /** The person it was about, when it was about one. */
  userId: string | null;
  /** The directory's own identifier for that person, scoped to the connection. */
  externalId: string | null;
  /** The group it was about, when it was about one. */
  groupId: string | null;
  /** The operation the fact names — create, update, deactivate, remove. */
  op: string | null;
  /** The failure's reason code, which the service turns into words. */
  errorCode: string | null;
}

/** The activity read the organization's reconciliation surface takes. */
export interface ScimSyncActivityReadRepository {
  findActivity(input: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly DirectoryActivityEntry[]>;
}

/**
 * Which facts read as something going wrong.
 *
 * A retired apply is a failure that has stopped being retried, and a
 * re-driven one is an operator putting it through again — both belong on the
 * "went wrong" side of the ledger, because both exist only because something
 * did. A recovery is the opposite and reads as ok.
 */
const REFUSED_TYPES: ReadonlySet<string> = new Set<string>([
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
]);

/** The scim_sync payload fields this surface reads, structurally. */
interface ScimSyncPayloadShape {
  userId?: unknown;
  externalId?: unknown;
  groupId?: unknown;
  op?: unknown;
  errorCode?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class EventLogScimSyncActivityRepository
  implements ScimSyncActivityReadRepository
{
  private readonly eventStore: () => Promise<EventStore<ScimSyncEvent>>;

  constructor(deps?: {
    /** Production resolves the App's event store lazily; tests hand one in. */
    eventStore?: () => Promise<EventStore<ScimSyncEvent>>;
  }) {
    this.eventStore =
      deps?.eventStore ?? (() => resolveEventStore<ScimSyncEvent>());
  }

  async findActivity({
    organizationId,
    connectionId,
    limit,
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly DirectoryActivityEntry[]> {
    const store = await this.eventStore();
    const events = await store.getEvents(
      scimSyncIdFor({ connectionId }),
      { tenantId: createTenantId(organizationId) },
      SCIM_SYNC_AGGREGATE_TYPE as AggregateType,
    );
    return events
      .map((event) => toActivityEntry(event))
      .sort((a, b) => b.occurredAtMs - a.occurredAtMs)
      .slice(0, limit);
  }
}

function toActivityEntry(event: ScimSyncEvent): DirectoryActivityEntry {
  const data = event.data as ScimSyncPayloadShape;
  return {
    eventId: event.id,
    type: event.type as ScimSyncEventType,
    occurredAtMs: event.occurredAt,
    outcome: REFUSED_TYPES.has(event.type) ? "refused" : "ok",
    userId: text(data.userId),
    externalId: text(data.externalId),
    groupId: text(data.groupId),
    op: text(data.op),
    errorCode: text(data.errorCode),
  };
}

/** The event types this surface knows how to word. Exported so the copy map
 *  and the reader cannot drift apart silently. */
export const DIRECTORY_ACTIVITY_TYPES = [
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
] as const;
