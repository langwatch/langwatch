import type { ClickHouseClient } from "@clickhouse/client";

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

/** Simplified event type matching what fold and map projections consume. */
export interface ReplayEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  /** Alias of `timestamp`; matches the canonical domain `Event.createdAt`. */
  createdAt: number;
  /** Retained for backwards-compat with replay-internal call sites. */
  timestamp: number;
  occurredAt: number;
  type: string;
  version: string;
  idempotencyKey: string;
  data: unknown;
  metadata?: { processingTraceparent?: string };
}

/** Aggregate discovered for replay. */
export interface DiscoveredAggregate {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
}

/** Discovered aggregate plus the distinct event types found on it. */
export interface DiscoveredAggregateWithEventTypes extends DiscoveredAggregate {
  eventTypes: string[];
}

function rowToEvent(row: ClickHouseEventRow): ReplayEvent {
  const data =
    row.EventPayload && row.EventPayload.length > 0
      ? JSON.parse(row.EventPayload)
      : null;

  const occurredAt =
    row.EventOccurredAt && row.EventOccurredAt > 0
      ? row.EventOccurredAt
      : row.EventTimestamp;

  return {
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
  client: ClickHouseClient;
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
  client: ClickHouseClient;
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

/** Cutoff info for an aggregate: the last event's timestamp and ID. */
export interface CutoffInfo {
  timestamp: number;
  eventId: string;
}

/** Compare canonical event-log positions. Aggregate IDs never define order. */
export function compareEventPositions(
  left: CutoffInfo,
  right: CutoffInfo,
): number {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }
  return left.eventId.localeCompare(right.eventId);
}

/** Return the latest canonical position from a non-empty collection. */
export function maxEventPosition(positions: Iterable<CutoffInfo>): CutoffInfo {
  const iterator = positions[Symbol.iterator]();
  const first = iterator.next();
  if (first.done) {
    throw new Error(
      "Cannot find the latest event position in an empty collection",
    );
  }

  let latest = first.value;
  for (let next = iterator.next(); !next.done; next = iterator.next()) {
    if (compareEventPositions(next.value, latest) > 0) latest = next.value;
  }
  return latest;
}

/**
 * Inclusive `EventOccurredAt` range (ms) covering EVERY event of a set of
 * aggregates. Used purely as a partition-pruning predicate: `event_log` is
 * `PARTITION BY toYearWeek(EventOccurredAt)`, so without a WHERE on
 * `EventOccurredAt` every cutoff/load query scans ALL partitions — including
 * cold storage on S3 — once per batch.
 */
export interface OccurredAtBounds {
  minMs: number;
  maxMs: number;
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
  client: ClickHouseClient;
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
  client: ClickHouseClient;
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
  client: ClickHouseClient;
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
 * Load ALL events for a set of aggregates in a single ClickHouse query.
 * No eventTypes filter — different projections may need different event types,
 * so we load everything and let callers filter by cutoff per aggregate.
 *
 * Returns events grouped by aggregate key (`{tenantId}:{aggregateType}:{aggregateId}`).
 */
export async function loadEventsForAggregatesBulk({
  client,
  tenantId,
  aggregateIds,
  cutoffs,
  occurredAtBounds,
}: {
  client: ClickHouseClient;
  tenantId: string;
  aggregateIds: string[];
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds?: OccurredAtBounds;
}): Promise<Map<string, ReplayEvent[]>> {
  if (aggregateIds.length === 0) return new Map();

  const pruning = occurredAtPredicate(occurredAtBounds);
  const result = await client.query({
    query: `
      SELECT EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload,
             EventVersion, TenantId, AggregateType, AggregateId, ProcessingTraceparent,
             IdempotencyKey
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND AggregateId IN ({aggregateIds:Array(String)})
        ${pruning.sql}
      ORDER BY AggregateId, EventTimestamp ASC, EventId ASC
    `,
    query_params: { tenantId, aggregateIds, ...pruning.params },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as ClickHouseEventRow[];
  const grouped = new Map<string, ReplayEvent[]>();

  for (const row of rows) {
    const key = `${tenantId}:${row.AggregateType}:${row.AggregateId}`;
    const cutoff = cutoffs.get(key);

    // Skip events beyond the cutoff for this aggregate
    if (cutoff) {
      const eventTimestamp =
        typeof row.EventTimestamp === "string"
          ? parseInt(row.EventTimestamp, 10)
          : row.EventTimestamp;
      if (eventTimestamp > cutoff.timestamp) continue;
      if (eventTimestamp === cutoff.timestamp && row.EventId > cutoff.eventId)
        continue;
    }

    let list = grouped.get(key);
    if (!list) {
      list = [];
      grouped.set(key, list);
    }
    list.push(rowToEvent(row));
  }

  return grouped;
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
}: {
  client: ClickHouseClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  maxCutoff: CutoffInfo;
  cursor?: CutoffInfo;
  batchSize: number;
  occurredAtBounds?: OccurredAtBounds;
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
  return rows.map(rowToEvent);
}
