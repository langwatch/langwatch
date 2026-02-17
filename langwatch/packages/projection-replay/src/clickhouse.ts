import { type ClickHouseClient, createClient } from "@clickhouse/client";

/** ClickHouse event_log row shape. */
export interface ClickHouseEventRow {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventType: string;
  EventTimestamp: number;
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

  return {
    id: row.EventId,
    aggregateId: row.AggregateId,
    aggregateType: row.AggregateType,
    tenantId: row.TenantId,
    timestamp: row.EventTimestamp,
    occurredAt: row.EventTimestamp,
    type: row.EventType,
    version: "2025-01-01",
    data,
    metadata: row.ProcessingTraceparent
      ? { processingTraceparent: row.ProcessingTraceparent }
      : undefined,
  };
}

export function createClickHouseClient(url: string): ClickHouseClient {
  return createClient({ url });
}

/**
 * Discover aggregates with events of the given types since a timestamp.
 * Returns distinct (tenantId, aggregateType, aggregateId) tuples ordered by tenantId.
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
  tenantId: string;
}): Promise<DiscoveredAggregate[]> {
  const result = await client.query({
    query: `
      SELECT DISTINCT
        TenantId AS tenantId,
        AggregateType AS aggregateType,
        AggregateId AS aggregateId
      FROM event_log
      WHERE EventType IN ({eventTypes:Array(String)})
        AND EventTimestamp >= {sinceMs:UInt64}
        AND TenantId = {tenantId:String}
      ORDER BY TenantId
    `,
    query_params: { eventTypes: [...eventTypes], sinceMs, tenantId },
    format: "JSONEachRow",
  });

  return (await result.json()) as DiscoveredAggregate[];
}

/**
 * Count total events that will be replayed for discovered aggregates.
 * Counts ALL events from the beginning (not just since the window) because
 * replay loads full history for each aggregate.
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
  tenantId: string;
}): Promise<number> {
  const result = await client.query({
    query: `
      SELECT count() as totalEvents
      FROM event_log
      WHERE EventType IN ({eventTypes:Array(String)})
        AND TenantId = {tenantId:String}
        AND (AggregateType, AggregateId) IN (
          SELECT DISTINCT AggregateType, AggregateId
          FROM event_log
          WHERE EventType IN ({eventTypes:Array(String)})
            AND EventTimestamp >= {sinceMs:UInt64}
            AND TenantId = {tenantId:String}
        )
    `,
    query_params: { eventTypes: [...eventTypes], tenantId, sinceMs },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as { totalEvents: string }[];
  return parseInt(rows[0]?.totalEvents ?? "0", 10);
}

/**
 * Get cutoff EventIds for a batch of aggregates in one query.
 * Returns a map of aggregateKey → cutoffEventId.
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
}): Promise<Map<string, string>> {
  const result = await client.query({
    query: `
      SELECT
        AggregateType AS aggregateType,
        AggregateId AS aggregateId,
        max(EventId) AS cutoffEventId
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
  }[];

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(`${tenantId}:${row.aggregateType}:${row.aggregateId}`, row.cutoffEventId);
  }
  return map;
}

/**
 * Load events for a batch of aggregates up to a max cutoff, with cursor-based pagination.
 * Caller must filter per-aggregate cutoffs in JS.
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
    SELECT EventId, EventTimestamp, EventType, EventPayload,
           TenantId, AggregateType, AggregateId, ProcessingTraceparent
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
