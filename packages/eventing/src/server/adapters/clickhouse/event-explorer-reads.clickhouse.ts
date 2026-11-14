import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";

import { eventLog } from "./event-log-table.clickhouse.ts";

/** Only the `ops_event_log_search` worker runs these (ADR-202 Decided 14); the api only asks. */
const OPERATOR_SEARCH_REASON =
  "operator event search across tenants, run by the ops_event_log_search worker";

const operatorSearch = () =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason: OPERATOR_SEARCH_REASON }) }).from(
    eventLog,
  );

const hasTenants = (tenantIds: readonly string[] | undefined): tenantIds is readonly string[] =>
  tenantIds !== undefined && tenantIds.length > 0;

/** How many aggregates of each type each tenant holds since a time; legacy `0` rows are kept. */
export function aggregateDiscoveryRead({
  aggregateTypes,
  sinceMs,
  tenantIds,
}: {
  aggregateTypes: readonly string[];
  sinceMs: number;
  tenantIds?: readonly string[] | undefined;
}) {
  const read = operatorSearch()
    .select({
      aggregateType: eventLog.AggregateType,
      tenantId: eventLog.TenantId,
      aggregateCount: fn.countDistinct(eventLog.AggregateId),
    })
    .where(({ and, eq, gte, oneOf, or }) =>
      and(
        oneOf(eventLog.AggregateType, aggregateTypes),
        or(eq(eventLog.EventOccurredAt, 0), gte(eventLog.EventOccurredAt, sinceMs)),
      ),
    );
  const scoped = hasTenants(tenantIds)
    ? read.where(({ oneOf }) => oneOf(eventLog.TenantId, tenantIds))
    : read;
  return {
    statement: scoped
      .groupBy(eventLog.AggregateType, eventLog.TenantId)
      .orderBy(eventLog.AggregateType)
      .orderBy(eventLog.TenantId)
      .build(),
  };
}

/** The 50 most recent aggregates whose id or tenant matches; the caller bounds it first. */
export function aggregateSearchRead({
  queryPattern,
  tenantIds,
  sinceMs,
}: {
  queryPattern: string | undefined;
  tenantIds: readonly string[] | undefined;
  sinceMs: number | undefined;
}) {
  const read = operatorSearch().select({
    aggregateId: eventLog.AggregateId,
    aggregateType: eventLog.AggregateType,
    tenantId: eventLog.TenantId,
    eventCount: fn.count(),
    lastEventTime: fn.max(eventLog.EventTimestamp),
  });
  const bounded =
    typeof sinceMs === "number" && sinceMs > 0
      ? read.where(({ eq, gte, or }) =>
          or(eq(eventLog.EventOccurredAt, 0), gte(eventLog.EventOccurredAt, sinceMs)),
        )
      : read;
  const scoped = hasTenants(tenantIds)
    ? bounded.where(({ oneOf }) => oneOf(eventLog.TenantId, tenantIds))
    : bounded;
  const matched =
    queryPattern === undefined
      ? scoped
      : scoped.where(({ or }) =>
          or(fn.like(eventLog.AggregateId, queryPattern), fn.like(eventLog.TenantId, queryPattern)),
        );
  return {
    statement: matched
      .groupBy(eventLog.AggregateId, eventLog.AggregateType, eventLog.TenantId)
      .orderBy("lastEventTime", "DESC")
      .limit(50)
      .build(),
  };
}

/** One aggregate's whole history in acceptance order, read on its own tenant's server. */
export function aggregateHistoryRead({
  tenantId,
  aggregateId,
  limit,
}: {
  tenantId: string;
  aggregateId: string;
  limit: number;
}) {
  return {
    statement: clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(eventLog)
      .select({
        eventId: eventLog.EventId,
        eventType: eventLog.EventType,
        eventTimestamp: eventLog.EventTimestamp,
        payload: eventLog.EventPayload,
      })
      .where(({ eq }) => eq(eventLog.AggregateId, aggregateId))
      .orderBy(eventLog.EventTimestamp)
      .orderBy(eventLog.EventId)
      .limit(limit)
      .build(),
  };
}
