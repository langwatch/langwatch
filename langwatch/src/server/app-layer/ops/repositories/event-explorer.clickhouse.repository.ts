import type { ClickHouseClient } from "@clickhouse/client";
import type {
  AggregateDiscoveryRow,
  AggregateSearchResult,
  EventExplorerRepository,
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
    //
    // `EventOccurredAt = 0` is the historical sentinel for events that pre-date
    // the column (added after the table was already in production). Those rows
    // still live in the epoch-week partition and are real aggregates the bulk
    // replay wizard must be able to surface; a naïve `>= sinceMs` filter would
    // silently drop them. Including `OR EventOccurredAt = 0` keeps partition
    // pruning (epoch-week + last-N-weeks instead of every partition) while
    // preserving the legacy rows.
    const result = await this.client.query({
      query: `
        SELECT
          AggregateType AS aggregateType,
          TenantId AS tenantId,
          count(DISTINCT AggregateId) AS aggregateCount
        FROM event_log
        WHERE AggregateType IN ({aggregateTypes:Array(String)})
          AND (EventOccurredAt = 0 OR EventOccurredAt >= {sinceMs:UInt64})
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
      // Rationale lives in the comment above (cross-tenant unbounded scan
      // over the whole event_log) but the message reaches the ops UI - the
      // user-facing text should tell them what to do, not name the method.
      throw new Error(
        "Enter a search query or pick at least one tenant before searching.",
      );
    }

    // No silent time clamp here - DejaView is the internal ops admin tool, and
    // operators searching for old aggregates during incident archaeology
    // mustn't get empty results with no explanation. The hot/cold-tier bound
    // is surfaced *in the DejaView UI* (uses the same env-var-derived value
    // the TTL reconciler does) so the operator sees "older than N days lives
    // in cold storage" up front, rather than the backend silently dropping
    // rows. Tradeoff: a truly unbounded cross-tenant scan stays expensive,
    // but the upfront guard above (must supply tenants or a query string)
    // already prevents the worst shape.
    const queryParams: Record<string, unknown> = {};

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
        WHERE 1=1
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
