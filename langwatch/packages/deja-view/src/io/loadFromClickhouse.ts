import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type { Event } from "../lib/types";
import { type ClickHouseEventRow, clickHouseRowToEvent } from "./loadEvents";
import {
  type Environment,
  getClickHouseHost,
  getClickHousePassword,
} from "./secrets";

export interface ClickHouseConfig {
  env: Environment;
  profile?: string;
}

/**
 * Creates a ClickHouse client connected to the specified environment.
 *
 * @example
 * const client = await createClickHouseClient({ env: "dev", profile: "lw-dev" });
 */
async function createClickHouseClient(
  config: ClickHouseConfig,
): Promise<ClickHouseClient> {
  const { env, profile } = config;

  const host = getClickHouseHost(env);
  const password = await getClickHousePassword(env, { profile });
  const url = `https://:${encodeURIComponent(password)}@${host}:8123/langwatch`;

  return createClient({ url });
}

/**
 * Fetches events for a specific aggregate ID from ClickHouse.
 *
 * @example
 * const events = await loadEventsFromClickhouse({
 *   aggregateId: "trace_abc123",
 *   env: "dev",
 *   profile: "lw-dev",
 * });
 */
export async function loadEventsFromClickhouse(config: {
  aggregateId: string;
  env: Environment;
  profile?: string;
}): Promise<Event[]> {
  const { aggregateId, env, profile } = config;

  const client = await createClickHouseClient({ env, profile });

  try {
    const result = await client.query({
      query: `
        SELECT
          TenantId,
          IdempotencyKey,
          AggregateType,
          AggregateId,
          EventId,
          EventType,
          EventTimestamp,
          CreatedAt,
          EventPayload,
          ProcessingTraceparent
        FROM event_log
        WHERE AggregateId = {aggregateId:String}
        ORDER BY EventTimestamp ASC
      `,
      query_params: { aggregateId },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as ClickHouseEventRow[];
    return rows.map(clickHouseRowToEvent);
  } finally {
    await client.close();
  }
}

/**
 * Fetches a list of recent aggregate IDs from ClickHouse for selection.
 *
 * @example
 * const aggregates = await listRecentAggregates({ env: "dev", profile: "lw-dev" });
 */
export async function listRecentAggregates(config: {
  env: Environment;
  profile?: string;
  limit?: number;
}): Promise<
  { aggregateId: string; aggregateType: string; eventCount: number }[]
> {
  const { env, profile, limit = 50 } = config;

  const client = await createClickHouseClient({ env, profile });

  try {
    const result = await client.query({
      query: `
        SELECT
          AggregateId as aggregateId,
          any(AggregateType) as aggregateType,
          count() as eventCount
        FROM event_log
        GROUP BY AggregateId
        ORDER BY max(EventTimestamp) DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { limit },
      format: "JSONEachRow",
    });

    return await result.json();
  } finally {
    await client.close();
  }
}

/**
 * Configuration for querying child aggregates.
 * Maps child aggregate types to their JSON path for extracting parent ID.
 */
export const CHILD_AGGREGATE_JSON_PATHS: Record<string, string> = {
  // span -> trace: the traceId is in spanData.traceId
  span: "spanData.traceId",
};

/**
 * Fetches child aggregate IDs that reference a parent aggregate.
 *
 * @example
 * const spans = await queryChildAggregates({
 *   parentId: "trace_abc123",
 *   childAggregateType: "span",
 *   env: "dev",
 *   profile: "lw-dev",
 * });
 */
export async function queryChildAggregates(config: {
  parentId: string;
  childAggregateType: string;
  env: Environment;
  profile?: string;
  limit?: number;
}): Promise<string[]> {
  const { parentId, childAggregateType, env, profile, limit = 100 } = config;

  const jsonPath = CHILD_AGGREGATE_JSON_PATHS[childAggregateType];
  if (!jsonPath) {
    // Unknown child type, can't query
    return [];
  }

  const client = await createClickHouseClient({ env, profile });

  try {
    // Build the JSONExtractString path from dot notation
    const pathParts = jsonPath.split(".");
    const jsonExtractArgs = pathParts.map((p) => `'${p}'`).join(", ");

    const result = await client.query({
      query: `
        SELECT DISTINCT AggregateId as aggregateId
        FROM event_log
        WHERE AggregateType = {childAggregateType:String}
          AND JSONExtractString(EventPayload, ${jsonExtractArgs}) = {parentId:String}
        LIMIT {limit:UInt32}
      `,
      query_params: { parentId, childAggregateType, limit },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as { aggregateId: string }[];
    return rows.map((r) => r.aggregateId);
  } finally {
    await client.close();
  }
}
