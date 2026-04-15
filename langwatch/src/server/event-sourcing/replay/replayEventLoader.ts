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
}

/** Simplified event type matching what fold projections consume. */
export interface ReplayEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  timestamp: number;
  occurredAt: number;
  type: string;
  version: string;
  data: unknown;
  metadata?: { processingTraceparent?: string };
}

/** Aggregate discovered for replay. */
export interface DiscoveredAggregate {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
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
    timestamp: row.EventTimestamp,
    occurredAt,
    type: row.EventType,
    version: row.EventVersion ?? "2025-01-01",
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
}): Promise<DiscoveredAggregate[]> {
  const tenantFilter = tenantId ? "AND TenantId = {tenantId:String}" : "";
  const params: Record<string, unknown> = { eventTypes: [...eventTypes], sinceMs };
  if (tenantId) params.tenantId = tenantId;

  const result = await client.query({
    query: `
      SELECT DISTINCT
        TenantId AS tenantId,
        AggregateType AS aggregateType,
        AggregateId AS aggregateId
      FROM event_log
      WHERE EventType IN ({eventTypes:Array(String)})
        AND EventTimestamp >= {sinceMs:UInt64}
        ${tenantFilter}
      ORDER BY TenantId
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  return (await result.json()) as DiscoveredAggregate[];
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
  const params: Record<string, unknown> = { eventTypes: [...eventTypes], sinceMs };
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

/**
 * Get cutoff event info for a batch of aggregates in one query.
 */
export async function batchGetCutoffEventIds({
  client,
  tenantId,
  aggregateIds,
  eventTypes,
}: {
  client: ClickHouseClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
}): Promise<Map<string, CutoffInfo>> {
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
      GROUP BY AggregateType, AggregateId
    `,
    query_params: { tenantId, eventTypes: [...eventTypes], aggregateIds },
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
}: {
  client: ClickHouseClient;
  tenantId: string;
  aggregateIds: string[];
  cutoffs: Map<string, CutoffInfo>;
}): Promise<Map<string, ReplayEvent[]>> {
  if (aggregateIds.length === 0) return new Map();

  const result = await client.query({
    query: `
      SELECT EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload,
             EventVersion, TenantId, AggregateType, AggregateId, ProcessingTraceparent
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND AggregateId IN ({aggregateIds:Array(String)})
      ORDER BY AggregateId, EventTimestamp ASC, EventId ASC
    `,
    query_params: { tenantId, aggregateIds },
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
      if (eventTimestamp === cutoff.timestamp && row.EventId > cutoff.eventId) continue;
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
  maxCutoffEventId,
  cursorEventId,
  batchSize,
}: {
  client: ClickHouseClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  maxCutoffEventId: string;
  cursorEventId: string;
  batchSize: number;
}): Promise<ReplayEvent[]> {
  const hasCursor = cursorEventId.length > 0;

  const query = `
    SELECT EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload,
           EventVersion, TenantId, AggregateType, AggregateId, ProcessingTraceparent
    FROM event_log
    WHERE TenantId = {tenantId:String}
      AND EventType IN ({eventTypes:Array(String)})
      AND AggregateId IN ({aggregateIds:Array(String)})
      AND EventId <= {maxCutoffEventId:String}
      ${hasCursor ? "AND EventId > {cursorEventId:String}" : ""}
    ORDER BY EventId ASC
    LIMIT {batchSize:UInt32}
  `;

  const result = await client.query({
    query,
    query_params: {
      tenantId,
      eventTypes: [...eventTypes],
      aggregateIds,
      maxCutoffEventId,
      ...(hasCursor ? { cursorEventId } : {}),
      batchSize,
    },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as ClickHouseEventRow[];
  return rows.map(rowToEvent);
}
