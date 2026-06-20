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

    // event_log partitions on `toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))`,
    // NOT on EventTimestamp. The previous version filtered on EventTimestamp,
    // which is the ReplacingMergeTree version column (ingest-time) — that
    // predicate does not prune partitions, so every weekly partition was
    // scanned including cold S3 ones. EventOccurredAt is what the partition
    // key is derived from and is also closer to the caller's intent
    // ("aggregates active since this real-world time").
    const result = await this.client.query({
      query: `
        SELECT
          AggregateType AS aggregateType,
          TenantId AS tenantId,
          count(DISTINCT AggregateId) AS aggregateCount
        FROM event_log
        WHERE AggregateType IN ({aggregateTypes:Array(String)})
          AND EventOccurredAt >= {sinceMs:UInt64}
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
    // Defensive guard: without at least one of (tenants, query string) the
    // query degrades to "ORDER BY EventTimestamp DESC LIMIT 50" against the
    // entire event_log table — every weekly partition incl. cold S3, every
    // tenant, just to surface 50 rows. The doc rule "TenantId is always
    // required" applies, but this is an ops/admin tool so we allow the
    // cross-tenant case when a non-empty query string at least bounds it.
    const hasTenants =
      params.tenantIds !== undefined && params.tenantIds.length > 0;
    const trimmedQuery = params.query.trim();
    const hasQueryString = trimmedQuery.length > 0;
    if (!hasTenants && !hasQueryString) {
      throw new Error(
        "EventExplorer.searchAggregates: provide either tenantIds or a non-empty query string — an unbounded scan over event_log is not allowed.",
      );
    }

    // Always bound by EventOccurredAt to prune partitions. 90 days is a
    // generous default that covers ops triage windows; callers can extend
    // by exposing a sinceMs parameter when there's a real need.
    const SCAN_LOOKBACK_DAYS = 90;
    const sinceMs = Date.now() - SCAN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const queryParams: Record<string, unknown> = { sinceMs };

    let tenantFilter = "";
    if (hasTenants) {
      tenantFilter = "AND TenantId IN ({tenantIds:Array(String)})";
      queryParams.tenantIds = params.tenantIds;
    }

    let aggregateFilter = "";
    if (hasQueryString) {
      aggregateFilter =
        "AND (AggregateId LIKE {queryPattern:String} OR TenantId LIKE {queryPattern:String})";
      queryParams.queryPattern = `%${trimmedQuery}%`;
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
        WHERE EventOccurredAt >= {sinceMs:UInt64}
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
    sinceMs?: number;
  }): Promise<RawEventRow[]> {
    // Heavy column read (EventPayload, ZSTD(3)). Without an EventOccurredAt
    // bound the read walks every weekly partition for the aggregate — the
    // primary key seeks to (TenantId, AggregateType, AggregateId, …) per
    // partition but pays cold-S3 metadata fetches for the inactive ones.
    //
    // Caller semantics:
    //   * Routine event-listing (ops UI) — pass sinceMs (e.g. last 30 days)
    //     to bound the scan to warm partitions only.
    //   * Projection replay — explicitly omit sinceMs to read the full
    //     event history of an aggregate (necessary for fold correctness).
    const queryParams: Record<string, unknown> = {
      tenantId: params.tenantId,
      aggregateId: params.aggregateId,
      limit: params.limit,
    };
    let timeFilter = "";
    if (typeof params.sinceMs === "number" && params.sinceMs > 0) {
      timeFilter = "AND EventOccurredAt >= {sinceMs:UInt64}";
      queryParams.sinceMs = params.sinceMs;
    }

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
          ${timeFilter}
        ORDER BY EventTimestamp ASC, EventId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    return (await result.json()) as RawEventRow[];
  }
}
