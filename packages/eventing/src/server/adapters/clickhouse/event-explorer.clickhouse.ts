import { ValidationError } from "../../../services/errorHandling.ts";
import type { EventingClickHouseReplayClient } from "../../clickhouse-client-resolver.ts";

/** How many aggregates of one type one tenant holds since a time. */
export interface AggregateDiscoveryRow {
  aggregateType: string;
  tenantId: string;
  aggregateCount: number;
}

/** One aggregate an operator's search matched. */
export interface AggregateSearchRow {
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  eventCount: number;
  lastEventTime: string;
}

/** One stored event as the explorer shows it: the payload stays the stored JSON text. */
export interface RawEventRow {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  payload: string;
}

/** A cross-tenant operator search names no tenant, so the routed member reads the shared server. */
const ACROSS_TENANTS = "";

/**
 * The operator's event explorer over the event log (ARCHITECTURE.md §7, ET-1), read through the
 * routed ClickHouse member: one aggregate's history reads its tenant's server, and a search across
 * tenants reads the shared one. Spec: packages/eventing/specs/event-table-surfaces.feature.
 */
export class EventingClickHouseEventExplorer {
  static create({
    clickhouse,
  }: {
    clickhouse: Pick<EventingClickHouseReplayClient, "query">;
  }): EventingClickHouseEventExplorer {
    return new EventingClickHouseEventExplorer(clickhouse);
  }

  private constructor(private readonly clickhouse: Pick<EventingClickHouseReplayClient, "query">) {}

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
    const { rows } = await this.clickhouse.query<{
      aggregateType: string;
      tenantId: string;
      aggregateCount: string;
    }>({
      tenantId: ACROSS_TENANTS,
      sql: `
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
      params: queryParams,
      unscoped: {
        reason:
          "Operator event explorer: the tenant filter is optional because an operator searches across tenants to find the aggregate to replay.",
      },
    });

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
  }): Promise<AggregateSearchRow[]> {
    // Without tenants or a query string the read scans every partition of every tenant for 50
    // rows; an operator search across tenants is allowed only when a query string bounds it.
    const hasTenants = params.tenantIds !== undefined && params.tenantIds.length > 0;
    const trimmedQuery = params.query.trim();
    const hasQueryString = trimmedQuery.length > 0;
    if (!hasTenants && !hasQueryString) {
      throw new ValidationError({
        reason: "An event search needs a query string or at least one tenant",
        field: "query",
        value: params.query,
      });
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

    const { rows } = await this.clickhouse.query<{
      aggregateId: string;
      aggregateType: string;
      tenantId: string;
      eventCount: string;
      lastEventTime: string;
    }>({
      tenantId: ACROSS_TENANTS,
      sql: `
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
      params: queryParams,
      unscoped: {
        reason:
          "Operator event explorer: the tenant filter is optional because an operator searches across tenants to find the aggregate to replay.",
      },
    });

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
    const { rows } = await this.clickhouse.query<RawEventRow>({
      tenantId: params.tenantId,
      sql: `
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
      params: {
        tenantId: params.tenantId,
        aggregateId: params.aggregateId,
        limit: params.limit,
      },
    });

    return rows;
  }
}
