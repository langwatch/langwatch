import type { ClickHouseClient } from "@clickhouse/client";
import type {
  EventExplorerRepository,
  AggregateDiscoveryRow,
  AggregateSearchResult,
  RawEventRow,
} from "./event-explorer.repository";

export class EventExplorerClickHouseRepository
  implements EventExplorerRepository
{
  private readonly client: ClickHouseClient;

  constructor(client: ClickHouseClient) {
    this.client = client;
  }

  async findAggregates(params: {
    aggregateTypes: string[];
    sinceMs: number;
    tenantIds?: string[];
  }): Promise<AggregateDiscoveryRow[]> {
    const hasTenantFilter =
      params.tenantIds !== undefined && params.tenantIds.length > 0;
    const tenantClause = hasTenantFilter
      ? "AND TenantId IN ({tenantIds:Array(String)})"
      : "";

    const queryParams: Record<string, unknown> = {
      aggregateTypes: params.aggregateTypes,
      sinceMs: params.sinceMs,
    };
    if (hasTenantFilter) {
      queryParams.tenantIds = params.tenantIds;
    }

    const result = await this.client.query({
      query: `
        SELECT
          AggregateType AS aggregateType,
          TenantId AS tenantId,
          count(DISTINCT AggregateId) AS aggregateCount
        FROM event_log
        WHERE AggregateType IN ({aggregateTypes:Array(String)})
          AND EventTimestamp >= {sinceMs:UInt64}
          ${tenantClause}
        GROUP BY AggregateType, TenantId
        ORDER BY AggregateType, TenantId
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      aggregateType: string;
      tenantId: string;
      aggregateCount: string;
    }>;

    return rows.map((row) => ({
      aggregateType: row.aggregateType,
      tenantId: row.tenantId,
      aggregateCount: parseInt(row.aggregateCount, 10),
    }));
  }

  async searchAggregates(params: {
    query: string;
    tenantIds?: string[];
  }): Promise<AggregateSearchResult[]> {
    const queryParams: Record<string, unknown> = {};

    let tenantFilter = "";
    if (params.tenantIds !== undefined && params.tenantIds.length > 0) {
      tenantFilter = "AND TenantId IN ({tenantIds:Array(String)})";
      queryParams.tenantIds = params.tenantIds;
    }

    let aggregateFilter = "";
    if (params.query.trim().length > 0) {
      aggregateFilter =
        "AND (AggregateId LIKE {queryPattern:String} OR TenantId LIKE {queryPattern:String})";
      queryParams.queryPattern = `%${params.query.trim()}%`;
    }

    const result = await this.client.query({
      query: `
        SELECT
          AggregateId AS aggregateId,
          AggregateType AS aggregateType,
          TenantId AS tenantId,
          count() AS eventCount,
          max(EventTimestamp) AS lastEventTime
        FROM event_log
        WHERE 1 = 1
          ${tenantFilter}
          ${aggregateFilter}
        GROUP BY AggregateId, AggregateType, TenantId
        ORDER BY lastEventTime DESC
        LIMIT 50
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      aggregateId: string;
      aggregateType: string;
      tenantId: string;
      eventCount: string;
      lastEventTime: string;
    }>;

    return rows.map((row) => ({
      aggregateId: row.aggregateId,
      aggregateType: row.aggregateType,
      tenantId: row.tenantId,
      eventCount: parseInt(row.eventCount, 10),
      lastEventTime: row.lastEventTime,
    }));
  }

  async findEventsByAggregate(params: {
    aggregateId: string;
    tenantId: string;
    limit: number;
  }): Promise<RawEventRow[]> {
    const result = await this.client.query({
      query: `
        SELECT
          EventId AS eventId,
          EventType AS eventType,
          EventTimestamp AS eventTimestamp,
          EventPayload AS payload
        FROM event_log
        WHERE TenantId = {tenantId:String}
          AND AggregateId = {aggregateId:String}
        ORDER BY EventTimestamp ASC, EventId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: params.tenantId,
        aggregateId: params.aggregateId,
        limit: params.limit,
      },
      format: "JSONEachRow",
    });

    return (await result.json()) as RawEventRow[];
  }
}
