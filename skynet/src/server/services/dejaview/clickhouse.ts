import { createClient, type ClickHouseClient } from "@clickhouse/client";

export interface DejaViewEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  timestamp: number;
  createdAt: string;
  type: string;
  data: unknown;
  metadata?: {
    processingTraceparent?: string;
    [key: string]: unknown;
  };
}

interface ClickHouseEventRow {
  TenantId: string;
  IdempotencyKey?: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventType: string;
  EventTimestamp: number;
  CreatedAt?: string;
  EventPayload: string;
  ProcessingTraceparent?: string;
}

function rowToEvent(row: ClickHouseEventRow): DejaViewEvent {
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
    createdAt: row.CreatedAt ?? "",
    type: row.EventType,
    data,
    metadata: {
      processingTraceparent: row.ProcessingTraceparent || undefined,
    },
  };
}

let clientInstance: ClickHouseClient | null = null;

function getClient(): ClickHouseClient {
  if (!clientInstance) {
    const url = process.env.CLICKHOUSE_URL;
    if (!url) {
      throw new Error("CLICKHOUSE_URL environment variable is not set");
    }
    clientInstance = createClient({ url });
  }
  return clientInstance;
}

export async function countEvents({ aggregateId, tenantId }: { aggregateId: string; tenantId: string }): Promise<number> {
  const client = getClient();

  const result = await client.query({
    query: `
      SELECT count() as cnt
      FROM event_log
      WHERE TenantId = {tenantId:String} AND AggregateId = {aggregateId:String}
    `,
    query_params: { aggregateId, tenantId },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as { cnt: string }[];
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

export async function loadEvents({ aggregateId, tenantId, limit }: { aggregateId: string; tenantId: string; limit?: number }): Promise<DejaViewEvent[]> {
  const client = getClient();

  const limitClause = limit ? `LIMIT {limit:UInt32}` : "";
  const result = await client.query({
    query: `
      SELECT
        TenantId, IdempotencyKey, AggregateType, AggregateId, EventId,
        EventType, EventTimestamp, CreatedAt, EventPayload, ProcessingTraceparent
      FROM event_log
      WHERE TenantId = {tenantId:String} AND AggregateId = {aggregateId:String}
      ORDER BY EventTimestamp ASC
      ${limitClause}
    `,
    query_params: { aggregateId, tenantId, ...(limit ? { limit } : {}) },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as ClickHouseEventRow[];
  return rows.map(rowToEvent);
}

export async function listRecentAggregates(limit = 50): Promise<
  { aggregateId: string; tenantId: string; aggregateType: string; eventCount: number }[]
> {
  const client = getClient();

  const result = await client.query({
    query: `
      SELECT
        AggregateId as aggregateId,
        TenantId as tenantId,
        any(AggregateType) as aggregateType,
        count() as eventCount
      FROM event_log
      GROUP BY AggregateId, TenantId
      ORDER BY max(EventTimestamp) DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { limit },
    format: "JSONEachRow",
  });

  return await result.json();
}

export async function searchAggregates(query: string, limit = 20): Promise<
  { aggregateId: string; tenantId: string; aggregateType: string; eventCount: number }[]
> {
  const client = getClient();

  const result = await client.query({
    query: `
      SELECT
        AggregateId as aggregateId,
        TenantId as tenantId,
        any(AggregateType) as aggregateType,
        count() as eventCount
      FROM event_log
      WHERE AggregateId LIKE {query:String}
      GROUP BY AggregateId, TenantId
      ORDER BY max(EventTimestamp) DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { query: `%${query}%`, limit },
    format: "JSONEachRow",
  });

  return await result.json();
}

const CHILD_AGGREGATE_JSON_PATHS: Record<string, string> = {
  span: "spanData.traceId",
};

export async function queryChildAggregates(config: {
  parentId: string;
  childAggregateType: string;
  tenantId: string;
  limit?: number;
}): Promise<string[]> {
  const { parentId, childAggregateType, tenantId, limit = 100 } = config;

  const jsonPath = CHILD_AGGREGATE_JSON_PATHS[childAggregateType];
  if (!jsonPath) return [];

  const client = getClient();
  const pathParts = jsonPath.split(".");
  const jsonExtractArgs = pathParts.map((p) => `'${p}'`).join(", ");

  const result = await client.query({
    query: `
      SELECT DISTINCT AggregateId as aggregateId
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND AggregateType = {childAggregateType:String}
        AND JSONExtractString(EventPayload, ${jsonExtractArgs}) = {parentId:String}
      LIMIT {limit:UInt32}
    `,
    query_params: { parentId, childAggregateType, tenantId, limit },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as { aggregateId: string }[];
  return rows.map((r) => r.aggregateId);
}
