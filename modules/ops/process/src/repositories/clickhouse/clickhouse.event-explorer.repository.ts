import type { AggregateSearchResult } from "@langwatch/ops-contract";

import type {
  AggregateDiscoveryRow,
  EventExplorerRepository,
  RawEventRow,
} from "../event-explorer.repository.ts";

/**
 * The read this repository issues, as it asks for it. Narrower than the driver
 * client so an operator-wide statement can carry its `unscoped` reason.
 */
export interface EventExplorerClickHouseClient {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    unscoped?: { reason: string };
  }): Promise<{ json(): Promise<unknown> }>;
}

export class EventExplorerClickHouseRepository implements EventExplorerRepository {
  static create({
    client,
  }: {
    client: EventExplorerClickHouseClient;
  }): EventExplorerClickHouseRepository {
    return new EventExplorerClickHouseRepository(client);
  }

  private constructor(private readonly client: EventExplorerClickHouseClient) {}

  async findAggregates(params: {
    aggregateTypes: string[];
    sinceMs: number;
    tenantIds?: string[];
  }): Promise<AggregateDiscoveryRow[]> {
    const hasTenantFilter = params.tenantIds !== undefined && params.tenantIds.length > 0;
    const tenantClause = hasTenantFilter ? "AND TenantId IN ({tenantIds:Array(String)})" : "";

    const queryParams: Record<string, unknown> = {
      aggregateTypes: params.aggregateTypes,
      sinceMs: params.sinceMs,
    };
    if (hasTenantFilter) {
      queryParams.tenantIds = params.tenantIds;
    }

    // event_log partitions on EventOccurredAt, not EventTimestamp, enabling
    // partition pruning. EventOccurredAt = 0 preserves legacy rows while still
    // pruning.
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
      unscoped: {
        reason:
          "Operator event explorer: the tenant filter is optional because an operator searches across tenants to find the aggregate to replay.",
      },
    });

    const rows = (await result.json()) as {
      aggregateType: string;
      tenantId: string;
      aggregateCount: string;
    }[];

    return rows.map((row) => ({
      aggregateType: row.aggregateType,
      tenantId: row.tenantId,
      aggregateCount: parseInt(row.aggregateCount, 10),
    }));
  }

  async searchAggregates(params: {
    query: string;
    tenantIds?: string[];
    sinceMs?: number;
  }): Promise<AggregateSearchResult[]> {
    // Defensive guard: without at least one of (tenants, query string) the query degrades to
    // "ORDER BY EventTimestamp DESC LIMIT 50" against the entire event_log table — every
    // weekly partition incl. cold S3, every tenant, just to surface 50 rows. The doc rule
    // "TenantId is always required" applies, but this is an ops/admin tool so we allow the
    // cross-tenant case when a non-empty query string at least bounds it.
    const hasTenants = params.tenantIds !== undefined && params.tenantIds.length > 0;
    const trimmedQuery = params.query.trim();
    const hasQueryString = trimmedQuery.length > 0;
    if (!hasTenants && !hasQueryString) {
      // Rationale lives in the comment above (cross-tenant unbounded scan
      // over the whole event_log) but the message reaches the ops UI - the
      // user-facing text should tell them what to do, not name the method.
      throw new Error("Enter a search query or pick at least one tenant before searching.");
    }

    // No silent time clamp in repo; caller supplies sinceMs explicitly.
    // EventOccurredAt = 0 is the legacy sentinel, preserved so historical
    // test data doesn't silently disappear.
    const queryParams: Record<string, unknown> = {};
    let timeBoundFilter = "";
    if (typeof params.sinceMs === "number" && params.sinceMs > 0) {
      timeBoundFilter = "AND (EventOccurredAt = 0 OR EventOccurredAt >= {sinceMs:UInt64})";
      queryParams.sinceMs = params.sinceMs;
    }

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
          ${timeBoundFilter}
          ${tenantFilter}
          ${aggregateFilter}
        GROUP BY AggregateId, AggregateType, TenantId
        ORDER BY lastEventTime DESC
        LIMIT 50
      `,
      query_params: queryParams,
      format: "JSONEachRow",
      unscoped: {
        reason:
          "Operator event explorer: the tenant filter is optional because an operator searches across tenants to find the aggregate to replay.",
      },
    });

    const rows = (await result.json()) as {
      aggregateId: string;
      aggregateType: string;
      tenantId: string;
      eventCount: string;
      lastEventTime: string;
    }[];

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
    // No `sinceMs` parameter: this is the detail-view query for a specific aggregate the
    // operator has already picked from the (bounded) DejaView search. Once you're looking at
    // one aggregate you want its full event history, including projection replays where the
    // fold depends on every event. The partition fan-out is acceptable here because the
    // aggregate-id seek is narrow per partition.
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
