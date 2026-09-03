import type {
  CutoffInfo,
  DiscoveredAggregateWithEventTypes,
  OccurredAtBounds,
  ReplayEvent,
  ReplayEventSource,
} from "../../../replay/replayEventSource";
import type {
  EventingClickHouseReplayClient,
  EventingClickHouseReplayClientResolver,
  EventingClickHouseRow,
} from "../../clickhouse-client-resolver";

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
 *
 * The transform belongs to the trace domain, which depends on this package, so
 * it cannot be imported here. It is a REQUIRED dependency rather than an
 * optional one with an identity default: replayed output is only byte-identical
 * to live output when the same lean runs at both seams, and a default would let
 * a composition that forgot it produce silently divergent projections instead of
 * failing to compile.
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
  const tenantFilter = tenantId ? "AND TenantId = {tenantId:String}" : "";
  const params: Record<string, unknown> = {
    eventTypes: [...eventTypes],
    sinceMs,
  };
  if (tenantId) params.tenantId = tenantId;

  const result = await client.query({
    query: `
      SELECT
        TenantId AS tenantId,
        AggregateType AS aggregateType,
        AggregateId AS aggregateId,
        groupUniqArray(EventType) AS eventTypes
      FROM event_log
      WHERE EventType IN ({eventTypes:Array(String)})
        AND EventTimestamp >= {sinceMs:UInt64}
        ${tenantFilter}
      GROUP BY TenantId, AggregateType, AggregateId
      ORDER BY TenantId
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  return (await result.json()) as DiscoveredAggregateWithEventTypes[];
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
  const params: Record<string, unknown> = {
    eventTypes: [...eventTypes],
    sinceMs,
  };
  if (tenantId) params.tenantId = tenantId;

  const result = await client.query({
    query: `
      SELECT count() as totalEvents
      FROM event_log
      WHERE ${tenantId ? "TenantId = {tenantId:String} AND" : ""} EventType IN ({eventTypes:Array(String)})
        AND (AggregateType, AggregateId) IN (
          SELECT DISTINCT AggregateType, AggregateId
          FROM event_log
          WHERE ${tenantId ? "TenantId = {tenantId:String} AND" : ""} EventType IN ({eventTypes:Array(String)})
            AND EventTimestamp >= {sinceMs:UInt64}
        )
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as { totalEvents: string }[];
  return parseInt(rows[0]?.totalEvents ?? "0", 10);
}

/** SQL fragment + params for an optional occurred-at pruning predicate. */
function occurredAtPredicate(bounds?: OccurredAtBounds): {
  sql: string;
  params: Record<string, unknown>;
} {
  if (!bounds) return { sql: "", params: {} };
  return {
    sql: `AND EventOccurredAt >= {minOccurredAtMs:UInt64}
        AND EventOccurredAt <= {maxOccurredAtMs:UInt64}`,
    params: { minOccurredAtMs: bounds.minMs, maxOccurredAtMs: bounds.maxMs },
  };
}

/**
 * Compute the `EventOccurredAt` min/max over ALL events of the given
 * aggregates (no event-type filter, full history).
 *
 * This is the provably-safe pruning bound for a replay batch's subsequent
 * cutoff/load queries: every event those queries must see already existed
 * when this query ran, so it lies within [min, max] by construction. Events
 * appended afterwards carry an `EventTimestamp` after the batch's cutoff and
 * are handled by live processing per the replay marker protocol (ADR-015),
 * so excluding them from the bounded queries is correct. (Bounding by the
 * replay's `since` instead would be UNSAFE: fold projections rebuild from
 * `init()` and need the aggregate's full history, which can predate `since`.)
 *
 * The query itself reads only the tiny `EventOccurredAt` column via the
 * primary-key filter — cheap compared to the payload-bearing load queries it
 * lets ClickHouse prune. `event_log` is ORDER BY (TenantId, AggregateType,
 * AggregateId, IdempotencyKey), so the `AggregateType` predicate is required
 * for the key filter to stay a binary search instead of degrading to a scan
 * of the whole tenant prefix.
 *
 * Returns undefined when the aggregates have no events (nothing to prune or
 * load).
 */
export async function getAggregateOccurredAtBounds({
  client,
  tenantId,
  aggregateTypes,
  aggregateIds,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateTypes: string[];
  aggregateIds: string[];
}): Promise<OccurredAtBounds | undefined> {
  if (aggregateIds.length === 0) return undefined;

  const result = await client.query({
    query: `
      SELECT
        count() AS cnt,
        min(EventOccurredAt) AS minOccurredAt,
        max(EventOccurredAt) AS maxOccurredAt
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND AggregateType IN ({aggregateTypes:Array(String)})
        AND AggregateId IN ({aggregateIds:Array(String)})
    `,
    query_params: { tenantId, aggregateTypes, aggregateIds },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as {
    cnt: string;
    minOccurredAt: string;
    maxOccurredAt: string;
  }[];
  const row = rows[0];
  if (!row || parseInt(row.cnt, 10) === 0) return undefined;

  return {
    minMs: parseInt(row.minOccurredAt, 10),
    maxMs: parseInt(row.maxOccurredAt, 10),
  };
}

/**
 * Get cutoff event info for a batch of aggregates in one query.
 *
 * `occurredAtBounds` (when available) enables partition pruning; pass bounds
 * from {@link getAggregateOccurredAtBounds} so no event of these aggregates
 * can fall outside the range.
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
  const pruning = occurredAtPredicate(occurredAtBounds);
  const result = await client.query({
    query: `
      SELECT
        AggregateType AS aggregateType,
        AggregateId AS aggregateId,
        argMax(EventId, (EventTimestamp, EventId)) AS cutoffEventId,
        max(EventTimestamp) AS cutoffTimestamp
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND EventType IN ({eventTypes:Array(String)})
        AND AggregateId IN ({aggregateIds:Array(String)})
        ${pruning.sql}
      GROUP BY AggregateType, AggregateId
    `,
    query_params: {
      tenantId,
      eventTypes: [...eventTypes],
      aggregateIds,
      ...pruning.params,
    },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as {
    aggregateType: string;
    aggregateId: string;
    cutoffEventId: string;
    cutoffTimestamp: string;
  }[];

  const map = new Map<string, CutoffInfo>();
  for (const row of rows) {
    map.set(`${tenantId}:${row.aggregateType}:${row.aggregateId}`, {
      timestamp: parseInt(row.cutoffTimestamp, 10),
      eventId: row.cutoffEventId,
    });
  }
  return map;
}

/**
 * Compute occurred-at bounds for a batch of aggregates, then fetch their
 * cutoff event IDs bounded by those bounds — the shared "bounds first, then
 * cutoffs" sequence every replay batch path runs before loading events.
 *
 * Undefined bounds means the aggregates have zero events — the cutoff query
 * is skipped entirely, since it would otherwise scan every partition
 * unbounded just to return empty. In that case this returns empty cutoffs
 * plus `occurredAtBounds: undefined`, routing every aggregate down the
 * caller's without-cutoff/unmark path.
 */
export async function getBoundedCutoffs({
  client,
  tenantId,
  aggregateTypes,
  aggregateIds,
  eventTypes,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateTypes: string[];
  aggregateIds: string[];
  eventTypes: readonly string[];
}): Promise<{
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds: OccurredAtBounds | undefined;
}> {
  const occurredAtBounds = await getAggregateOccurredAtBounds({
    client,
    tenantId,
    aggregateTypes,
    aggregateIds,
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
 * Stream every event a replay batch must apply for a set of aggregates, in a
 * single ClickHouse query, invoking `onEvent` per row in per-aggregate
 * `(EventTimestamp, EventId)` order.
 *
 * Two deliberate properties over the previous materialize-then-filter load:
 *
 * - **Union event-type filter.** Only events of the selected projections'
 *   types leave ClickHouse. The cutoffs were computed over the same union, so
 *   the boundary stays consistent — and payload bytes for types no projection
 *   consumes are never read, decompressed, or JSON-parsed.
 * - **Streaming.** Rows are applied as they arrive rather than collected into
 *   one array; memory stays bounded by the accumulators (fold states + write
 *   buffer), not the batch's event count, and CPU apply time overlaps the
 *   network read.
 *
 * Events past an aggregate's cutoff are dropped row-by-row (the cutoff map is
 * per aggregate; the query's bound is the batch-wide occurred-at range).
 * `onEvent` may return a promise ONLY when it needs to flush (the map
 * accumulator's incremental drain) — returning undefined on the hot path
 * keeps the loop free of per-row await overhead.
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
  const result = await client.query({
    query: `
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
    query_params: {
      tenantId,
      eventTypes: [...eventTypes],
      aggregateIds,
      ...pruning.params,
    },
    format: "JSONEachRow",
  });

  let eventsApplied = 0;
  const stream = result.stream();
  for await (const rows of stream) {
    for (const streamedRow of rows as EventingClickHouseRow[]) {
      const row = streamedRow.json<ClickHouseEventRow>();
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
  const pruning = occurredAtPredicate(occurredAtBounds);

  const query = `
    SELECT EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload,
           EventVersion, TenantId, AggregateType, AggregateId, ProcessingTraceparent,
           IdempotencyKey
    FROM event_log
    WHERE TenantId = {tenantId:String}
      AND EventType IN ({eventTypes:Array(String)})
      AND AggregateId IN ({aggregateIds:Array(String)})
      AND (
        EventTimestamp < {maxCutoffTimestamp:UInt64}
        OR (
          EventTimestamp = {maxCutoffTimestamp:UInt64}
          AND EventId <= {maxCutoffEventId:String}
        )
      )
      ${
        cursor
          ? `AND (
        EventTimestamp > {cursorTimestamp:UInt64}
        OR (
          EventTimestamp = {cursorTimestamp:UInt64}
          AND EventId > {cursorEventId:String}
        )
      )`
          : ""
      }
      ${pruning.sql}
    ORDER BY EventTimestamp ASC, EventId ASC
    LIMIT {batchSize:UInt32}
  `;

  const result = await client.query({
    query,
    query_params: {
      tenantId,
      eventTypes: [...eventTypes],
      aggregateIds,
      maxCutoffTimestamp: maxCutoff.timestamp,
      maxCutoffEventId: maxCutoff.eventId,
      ...(cursor
        ? {
            cursorTimestamp: cursor.timestamp,
            cursorEventId: cursor.eventId,
          }
        : {}),
      batchSize,
      ...pruning.params,
    },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as ClickHouseEventRow[];
  return rows.map((row) => rowToEvent(row, lean));
}

/**
 * The canonical `event_log` reader replay runs against.
 *
 * Reads only. It never dispatches to subscribers or process managers, and
 * offers no seam that could — replay rebuilds derived state and must not
 * re-fire the side effects the original events already caused.
 */
export class EventingClickHouseReplayEventSource implements ReplayEventSource {
  private readonly resolveClient: EventingClickHouseReplayClientResolver;
  private readonly lean: ReplayEventLean;

  constructor(deps: {
    resolveClient: EventingClickHouseReplayClientResolver;
    lean: ReplayEventLean;
  }) {
    this.resolveClient = deps.resolveClient;
    this.lean = deps.lean;
  }

  async discoverAffectedAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<DiscoveredAggregateWithEventTypes[]> {
    return discoverAffectedAggregates({
      client: await this.resolveClient(input.tenantId ?? "default"),
      ...input,
    });
  }

  async countEventsForAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<number> {
    return countEventsForAggregates({
      client: await this.resolveClient(input.tenantId ?? "default"),
      ...input,
    });
  }

  async getBoundedCutoffs(input: {
    tenantId: string;
    aggregateTypes: string[];
    aggregateIds: string[];
    eventTypes: readonly string[];
  }) {
    return getBoundedCutoffs({
      client: await this.resolveClient(input.tenantId),
      ...input,
    });
  }

  async streamEventsForAggregates(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    cutoffs: Map<string, CutoffInfo>;
    occurredAtBounds?: OccurredAtBounds;
    onEvent: (event: ReplayEvent) => void | Promise<void>;
  }): Promise<{ eventsApplied: number }> {
    return streamEventsForAggregatesBulk({
      client: await this.resolveClient(input.tenantId),
      lean: this.lean,
      ...input,
    });
  }

  async loadAggregateEvents(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    maxCutoff: CutoffInfo;
    cursor?: CutoffInfo;
    batchSize: number;
    occurredAtBounds?: OccurredAtBounds;
  }): Promise<ReplayEvent[]> {
    return batchLoadAggregateEvents({
      client: await this.resolveClient(input.tenantId),
      lean: this.lean,
      ...input,
    });
  }

  async optimizeTables(tenantId: string, tables: readonly string[]): Promise<void> {
    const client = await this.resolveClient(tenantId);
    for (const table of tables) {
      await client.command({
        query: "OPTIMIZE TABLE {table:Identifier}",
        query_params: { table },
      });
    }
  }
}
