import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { ValidationError } from "../../../services/errorHandling.ts";
import {
  aggregateDiscoveryRead,
  aggregateHistoryRead,
  aggregateSearchRead,
} from "./event-explorer-reads.clickhouse.ts";

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

/**
 * The operator's event explorer over the event log (ARCHITECTURE.md §7, ET-1): one aggregate's
 * history reads its tenant's server on the reader, a search across tenants the shared one on the
 * system identity, which only the worker holds. Spec: event-table-surfaces.feature.
 */
export class EventingClickHouseEventExplorer {
  static create({
    clickhouse,
  }: {
    clickhouse: Pick<ClickHouseQueryClient, "read">;
  }): EventingClickHouseEventExplorer {
    return new EventingClickHouseEventExplorer(clickhouse);
  }

  private constructor(private readonly clickhouse: Pick<ClickHouseQueryClient, "read">) {}

  async findAggregates(params: {
    aggregateTypes: string[];
    sinceMs: number;
    tenantIds?: string[];
  }): Promise<AggregateDiscoveryRow[]> {
    // event_log partitions on EventOccurredAt, not EventTimestamp; `= 0` keeps legacy rows.
    const { rows } = await this.clickhouse.read(aggregateDiscoveryRead(params));

    return rows.map((row) => ({
      aggregateType: row.aggregateType,
      tenantId: row.tenantId,
      aggregateCount: Number(row.aggregateCount),
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

    // No silent time clamp here: the caller supplies sinceMs; `0` rows are the legacy sentinel.
    const { rows } = await this.clickhouse.read(
      aggregateSearchRead({
        queryPattern: hasQueryString ? `%${trimmedQuery}%` : undefined,
        tenantIds: params.tenantIds,
        sinceMs: params.sinceMs,
      }),
    );

    return rows.map((row) => ({
      aggregateId: row.aggregateId,
      aggregateType: row.aggregateType,
      tenantId: row.tenantId,
      eventCount: Number(row.eventCount),
      lastEventTime: String(row.lastEventTime),
    }));
  }

  async findEventsByAggregate(params: {
    aggregateId: string;
    tenantId: string;
    limit: number;
  }): Promise<RawEventRow[]> {
    // No `sinceMs`: the detail view of one aggregate the operator picked from the bounded search
    // wants its whole history, as a projection replay folds every event.
    const { rows } = await this.clickhouse.read(aggregateHistoryRead(params));

    return rows.map((row) => ({
      eventId: row.eventId,
      eventType: row.eventType,
      eventTimestamp: String(row.eventTimestamp),
      payload: row.payload,
    }));
  }
}
