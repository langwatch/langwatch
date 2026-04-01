import { type ClickHouseClient, createClient } from "@clickhouse/client";

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

export function createClickHouseClient(url: string): ClickHouseClient {
  return createClient({ url });
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
  const tenantFilter = tenantId ? "AND TenantId = {tenantId:String}" : "";
  const params: Record<string, unknown> = { eventTypes: [...eventTypes], sinceMs };
  if (tenantId) params.tenantId = tenantId;

  const result = await client.query({
    query: `
      SELECT count() as totalEvents
      FROM event_log
      WHERE EventType IN ({eventTypes:Array(String)})
        ${tenantId ? "AND TenantId = {tenantId:String}" : ""}
        AND (AggregateType, AggregateId) IN (
          SELECT DISTINCT AggregateType, AggregateId
          FROM event_log
          WHERE EventType IN ({eventTypes:Array(String)})
            AND EventTimestamp >= {sinceMs:UInt64}
            ${tenantFilter}
        )
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as { totalEvents: string }[];
  return parseInt(rows[0]?.totalEvents ?? "0", 10);
}

/**
 * Get cutoff EventIds for a batch of aggregates in one query.
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
