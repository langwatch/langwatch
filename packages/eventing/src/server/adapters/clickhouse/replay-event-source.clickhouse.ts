import {
  type CutoffInfo,
  type DiscoveredAggregateWithEventTypes,
  type OccurredAtBounds,
  type ReplayEvent,
  type ReplayEventSource,
} from "../../../replay/replayEventSource.ts";
import type { EventingClickHouseReplayClient } from "../../clickhouse-client-resolver.ts";
import { type EventLogIdIndex, eventLogOccurredRange } from "../../tables/event-log-id-index.ts";
import {
  affectedAggregatesRead,
  aggregateEventsPageRead,
  cutoffEventsRead,
  discoveredEventCountRead,
  occurredAtBoundsRead,
  replayTenantsRead,
} from "./replay-reads.clickhouse.ts";

/** ClickHouse event_log row shape. */
export interface ClickHouseEventRow {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventType: string;
  EventTimestamp: number;
  EventOccurredAt?: number;
  EventVersion?: string;
  EventPayload: string;
  ProcessingTraceparent?: string;
  IdempotencyKey?: string;
}

/**
 * The ADR-022 lean, supplied by the composition root.
 */
export type ReplayEventLean = (event: ReplayEvent) => ReplayEvent;

/**
 * Materialize a raw `event_log` row into the event shape every replay path
 * consumes — including the ADR-022 lean, applied here exactly once (see the
 * comment on the return).
 */
export function rowToEvent(row: ClickHouseEventRow, lean: ReplayEventLean): ReplayEvent {
  const data =
    row.EventPayload && row.EventPayload.length > 0 ? JSON.parse(row.EventPayload) : null;

  const occurredAt =
    row.EventOccurredAt && row.EventOccurredAt > 0 ? row.EventOccurredAt : row.EventTimestamp;

  const event: ReplayEvent = {
    id: row.EventId,
    aggregateId: row.AggregateId,
    aggregateType: row.AggregateType,
    tenantId: row.TenantId,
    createdAt: row.EventTimestamp,
    timestamp: row.EventTimestamp,
    occurredAt,
    type: row.EventType,
    version: row.EventVersion ?? "2025-01-01",
    idempotencyKey: row.IdempotencyKey ?? row.EventId,
    data,
    metadata: row.ProcessingTraceparent
      ? { processingTraceparent: row.ProcessingTraceparent }
      : undefined,
  };

  // ADR-022: lean ONCE, at materialization — the same interposition live
  // dispatch applies before its handlers. Every replay path consumes events
  // through this function, so a single lean here replaces one lean per
  // (event × projection) inside the accumulators while keeping replayed
  // output byte-identical to live.
  return lean(event);
}

/**
 * Discover aggregates with events of the given types since a timestamp.
 * When tenantId is omitted, discovers across ALL tenants.
 */
export async function discoverAffectedAggregates({
  client,
  eventTypes,
  sinceMs,
  tenantId,
}: {
  client: EventingClickHouseReplayClient;
  eventTypes: readonly string[];
  sinceMs: number;
  tenantId?: string;
}): Promise<DiscoveredAggregateWithEventTypes[]> {
  const { rows } = await client.read(affectedAggregatesRead({ eventTypes, sinceMs, tenantId }));
  return rows.map((row) => ({ ...row, eventTypes: [...row.eventTypes] }));
}

/**
 * The tenants holding any of the event types since a timestamp, one row each, so a replay lists
 * them before it discovers any aggregate. Read on the shared server: a private dataplane's tenants
 * are not listed here (plan pr-7536 F-5, MIG-REPLAY-SCALE risk R1).
 */
export async function discoverTenants({
  client,
  eventTypes,
  sinceMs,
}: {
  client: EventingClickHouseReplayClient;
  eventTypes: readonly string[];
  sinceMs: number;
}): Promise<string[]> {
  const { rows } = await client.read(replayTenantsRead({ eventTypes, sinceMs }));
  return rows.map((row) => row.tenantId);
}

/**
 * Count total events for discovered aggregates (ALL history, not just since window).
 */
export async function countEventsForAggregates({
  client,
  eventTypes,
  sinceMs,
  tenantId,
}: {
  client: EventingClickHouseReplayClient;
  eventTypes: readonly string[];
  sinceMs: number;
  tenantId?: string;
}): Promise<number> {
  const { rows } = await client.read(discoveredEventCountRead({ eventTypes, sinceMs, tenantId }));
  return Number(rows[0]?.totalEvents ?? 0);
}

/**
 * Compute the `EventOccurredAt` min/max over ALL events of the given aggregates (no event-type
 * filter, full history). With the event log index trusted for every type, its span answers; an
 * aggregate it has not seen reads the event log itself, unbounded, as before the index.
 */
export async function getAggregateOccurredAtBounds({
  client,
  tenantId,
  aggregateTypes,
  aggregateIds,
  eventLogIndex,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateTypes: string[];
  aggregateIds: string[];
  eventLogIndex?: EventLogIdIndex | undefined;
}): Promise<OccurredAtBounds | undefined> {
  if (aggregateIds.length === 0) return undefined;
  const indexed = await eventLogOccurredRange({
    index: eventLogIndex,
    read: "replay",
    tenantId,
    aggregateTypes,
    aggregateIds,
  });
  if (indexed !== null) return { minMs: indexed.fromMs, maxMs: indexed.toMs };

  const { rows } = await client.read(
    occurredAtBoundsRead({ tenantId, aggregateTypes, aggregateIds }),
  );

  const row = rows[0];
  if (!row || Number(row.cnt) === 0) return undefined;

  return {
    minMs: Number(row.minOccurredAt),
    maxMs: Number(row.maxOccurredAt),
  };
}

/**
 * Get cutoff event info for a batch of aggregates in one query. `occurredAtBounds` (when
 * available) enables partition pruning; pass bounds from {@link getAggregateOccurredAtBounds}
 * so no event of these aggregates can fall outside the range.
 */
export async function batchGetCutoffEventIds({
  client,
  tenantId,
  aggregateIds,
  eventTypes,
  occurredAtBounds,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  occurredAtBounds?: OccurredAtBounds;
}): Promise<Map<string, CutoffInfo>> {
  const { rows } = await client.read(
    cutoffEventsRead({ tenantId, aggregateIds, eventTypes, occurredAtBounds }),
  );

  const map = new Map<string, CutoffInfo>();
  for (const row of rows) {
    map.set(`${tenantId}:${row.aggregateType}:${row.aggregateId}`, {
      timestamp: Number(row.cutoffTimestamp),
      eventId: row.cutoffEventId,
    });
  }
  return map;
}

/**
 * Compute occurred-at bounds for a batch of aggregates, then fetch their cutoff event IDs
 * bounded by those bounds — the shared "bounds first, then cutoffs" sequence every replay batch
 * path runs before loading events.
 */
export async function getBoundedCutoffs({
  client,
  tenantId,
  aggregateTypes,
  aggregateIds,
  eventTypes,
  eventLogIndex,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateTypes: string[];
  aggregateIds: string[];
  eventTypes: readonly string[];
  eventLogIndex?: EventLogIdIndex | undefined;
}): Promise<{
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds: OccurredAtBounds | undefined;
}> {
  const occurredAtBounds = await getAggregateOccurredAtBounds({
    client,
    tenantId,
    aggregateTypes,
    aggregateIds,
    eventLogIndex,
  });
  if (!occurredAtBounds) {
    return {
      cutoffs: new Map<string, CutoffInfo>(),
      occurredAtBounds: undefined,
    };
  }

  const cutoffs = await batchGetCutoffEventIds({
    client,
    tenantId,
    aggregateIds,
    eventTypes,
    occurredAtBounds,
  });
  return { cutoffs, occurredAtBounds };
}

/**
 * The stream's optional occurred-at pruning text: the client streams no built statement yet, so
 * this one read stays raw. Rows with no occurred time (0) are always kept.
 */
function occurredAtPredicate(bounds?: OccurredAtBounds): {
  sql: string;
  params: Record<string, unknown>;
} {
  if (!bounds) return { sql: "", params: {} };
  return {
    sql: `AND (
          EventOccurredAt = 0
          OR (
            EventOccurredAt >= {minOccurredAtMs:UInt64}
            AND EventOccurredAt <= {maxOccurredAtMs:UInt64}
          )
        )`,
    params: { minOccurredAtMs: bounds.minMs, maxOccurredAtMs: bounds.maxMs },
  };
}

/**
 * Stream every event a replay batch must apply for a set of aggregates, in a single ClickHouse
 * query, invoking `onEvent` per row in per-aggregate `(EventTimestamp, EventId)` order.
 */
export async function streamEventsForAggregatesBulk({
  client,
  tenantId,
  aggregateIds,
  eventTypes,
  cutoffs,
  occurredAtBounds,
  lean,
  onEvent,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds?: OccurredAtBounds;
  lean: ReplayEventLean;
  onEvent: (event: ReplayEvent) => void | Promise<void>;
}): Promise<{ eventsApplied: number }> {
  if (aggregateIds.length === 0) return { eventsApplied: 0 };

  const pruning = occurredAtPredicate(occurredAtBounds);
  const batches = client.stream<ClickHouseEventRow>({
    tenantId,
    sql: `
      SELECT EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload,
             EventVersion, TenantId, AggregateType, AggregateId, ProcessingTraceparent,
             IdempotencyKey
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND EventType IN ({eventTypes:Array(String)})
        AND AggregateId IN ({aggregateIds:Array(String)})
        ${pruning.sql}
      ORDER BY AggregateId, EventTimestamp ASC, EventId ASC
    `,
    params: {
      tenantId,
      eventTypes: [...eventTypes],
      aggregateIds,
      ...pruning.params,
    },
  });

  let eventsApplied = 0;
  for await (const rows of batches) {
    for (const row of rows) {
      const key = `${tenantId}:${row.AggregateType}:${row.AggregateId}`;
      if (isRowBeyondCutoff(row, cutoffs.get(key))) continue;

      const maybePromise = onEvent(rowToEvent(row, lean));
      if (maybePromise instanceof Promise) await maybePromise;
      eventsApplied++;
    }
  }

  return { eventsApplied };
}

/** Whether a row falls past its aggregate's cutoff (skip it, live owns it). */
function isRowBeyondCutoff(row: ClickHouseEventRow, cutoff: CutoffInfo | undefined): boolean {
  if (!cutoff) return false;
  const eventTimestamp =
    typeof row.EventTimestamp === "string" ? parseInt(row.EventTimestamp, 10) : row.EventTimestamp;
  if (eventTimestamp > cutoff.timestamp) return true;
  return eventTimestamp === cutoff.timestamp && row.EventId > cutoff.eventId;
}

/**
 * Load events for a batch of aggregates up to a max cutoff, with cursor-based pagination.
 */
export async function batchLoadAggregateEvents({
  client,
  tenantId,
  aggregateIds,
  eventTypes,
  maxCutoff,
  cursor,
  batchSize,
  occurredAtBounds,
  lean,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  maxCutoff: CutoffInfo;
  cursor?: CutoffInfo;
  batchSize: number;
  occurredAtBounds?: OccurredAtBounds;
  lean: ReplayEventLean;
}): Promise<ReplayEvent[]> {
  const { rows } = await client.read(
    aggregateEventsPageRead({
      tenantId,
      aggregateIds,
      eventTypes,
      maxCutoff,
      cursor,
      batchSize,
      occurredAtBounds,
    }),
  );

  return rows.map((row) => rowToEvent(row, lean));
}

/**
 * The canonical `event_log` reader replay runs against, over the routed ClickHouse member, which
 * places each statement on its tenant's server. Reads only. It never dispatches to subscribers or
 * process managers, and offers no seam that could — replay must not re-fire side effects.
 */
export class EventingClickHouseReplayEventSource implements ReplayEventSource {
  private readonly clickhouse: EventingClickHouseReplayClient;
  private readonly lean: ReplayEventLean;
  private readonly eventLogIndex: EventLogIdIndex | undefined;

  constructor(deps: {
    clickhouse: EventingClickHouseReplayClient;
    lean: ReplayEventLean;
    /** Bounds each batch by the aggregate index once it is ready on the tenant's target. */
    eventLogIndex?: EventLogIdIndex;
  }) {
    this.clickhouse = deps.clickhouse;
    this.lean = deps.lean;
    this.eventLogIndex = deps.eventLogIndex;
  }

  discoverTenants(input: { eventTypes: readonly string[]; sinceMs: number }): Promise<string[]> {
    return discoverTenants({ client: this.clickhouse, ...input });
  }

  discoverAffectedAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<DiscoveredAggregateWithEventTypes[]> {
    return discoverAffectedAggregates({ client: this.clickhouse, ...input });
  }

  countEventsForAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<number> {
    return countEventsForAggregates({ client: this.clickhouse, ...input });
  }

  getBoundedCutoffs(input: {
    tenantId: string;
    aggregateTypes: string[];
    aggregateIds: string[];
    eventTypes: readonly string[];
  }) {
    return getBoundedCutoffs({
      client: this.clickhouse,
      eventLogIndex: this.eventLogIndex,
      ...input,
    });
  }

  streamEventsForAggregates(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    cutoffs: Map<string, CutoffInfo>;
    occurredAtBounds?: OccurredAtBounds;
    onEvent: (event: ReplayEvent) => void | Promise<void>;
  }): Promise<{ eventsApplied: number }> {
    return streamEventsForAggregatesBulk({ client: this.clickhouse, lean: this.lean, ...input });
  }

  loadAggregateEvents(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    maxCutoff: CutoffInfo;
    cursor?: CutoffInfo;
    batchSize: number;
    occurredAtBounds?: OccurredAtBounds;
  }): Promise<ReplayEvent[]> {
    return batchLoadAggregateEvents({ client: this.clickhouse, lean: this.lean, ...input });
  }

  async optimizeTables(tenantId: string, tables: readonly string[]): Promise<void> {
    for (const table of tables) {
      await this.clickhouse.command({
        tenantId,
        sql: "OPTIMIZE TABLE {table:Identifier}",
        params: { table },
        // Replay's post-rebuild OPTIMIZE TABLE names a table, not a tenant.
        SKIP_TENANT_CHECK: true,
      });
    }
  }
}
