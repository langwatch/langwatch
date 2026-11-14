import {
  type AllTenantsScope,
  clickhouseRead,
  type Condition,
  type ConditionOps,
  fn,
  type SingleTenantScope,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";

import type { CutoffInfo, OccurredAtBounds } from "../../../replay/replayEventSource.ts";
import { eventLog } from "./event-log-table.clickhouse.ts";

/** Only replay's runners send these: the ops_projection_replay worker and tasks-role steps. */
const ALL_TENANTS_REASON =
  "projection replay across every tenant, run by the ops_projection_replay worker or a tasks-role migration step";

/** The `event_log` columns replay reads back as a stored event. */
const REPLAY_ROW = {
  EventId: eventLog.EventId,
  EventTimestamp: eventLog.EventTimestamp,
  EventOccurredAt: eventLog.EventOccurredAt,
  EventType: eventLog.EventType,
  EventPayload: eventLog.EventPayload,
  EventVersion: eventLog.EventVersion,
  TenantId: eventLog.TenantId,
  AggregateType: eventLog.AggregateType,
  AggregateId: eventLog.AggregateId,
  ProcessingTraceparent: eventLog.ProcessingTraceparent,
  IdempotencyKey: eventLog.IdempotencyKey,
};

type Ops = Pick<ConditionOps<"event_log", never>, "and" | "eq" | "gte" | "lte" | "or">;

/** One tenant, or every tenant when the replay names none. */
const replayScope = (tenantId: string | undefined): SingleTenantScope | AllTenantsScope =>
  tenantId
    ? tenantScope.single({ tenantId })
    : tenantScope.allTenants({ reason: ALL_TENANTS_REASON });

/** Rows with no occurred time (0) are always kept: the index's bounds leave them out. */
function occurredWithin({ and, eq, gte, lte, or }: Ops, bounds: OccurredAtBounds): Condition {
  return or(
    eq(eventLog.EventOccurredAt, 0),
    and(gte(eventLog.EventOccurredAt, bounds.minMs), lte(eventLog.EventOccurredAt, bounds.maxMs)),
  );
}

/** Aggregates with any of the event types recorded since a time; every tenant when none named. */
export function affectedAggregatesRead({
  eventTypes,
  sinceMs,
  tenantId,
}: {
  eventTypes: readonly string[];
  sinceMs: number;
  tenantId?: string | undefined;
}) {
  const statement = clickhouseRead({ scope: replayScope(tenantId) })
    .from(eventLog)
    .select({
      tenantId: eventLog.TenantId,
      aggregateType: eventLog.AggregateType,
      aggregateId: eventLog.AggregateId,
      eventTypes: fn.groupUniqArray(eventLog.EventType),
    })
    .where(({ and, gte, oneOf }) =>
      and(oneOf(eventLog.EventType, eventTypes), gte(eventLog.EventTimestamp, sinceMs)),
    )
    .groupBy(eventLog.TenantId, eventLog.AggregateType, eventLog.AggregateId)
    .orderBy(eventLog.TenantId)
    .build();
  // The window is on recording time, which the occurred-at partition key does not carry.
  return { statement, declaresFullScan: true as const };
}

/** The tenants holding any of the event types since a time, read on the shared server. */
export function replayTenantsRead({
  eventTypes,
  sinceMs,
}: {
  eventTypes: readonly string[];
  sinceMs: number;
}) {
  const statement = clickhouseRead({
    scope: tenantScope.allTenants({ reason: ALL_TENANTS_REASON }),
  })
    .from(eventLog)
    .select({ tenantId: eventLog.TenantId })
    .distinct()
    .where(({ and, gte, oneOf }) =>
      and(oneOf(eventLog.EventType, eventTypes), gte(eventLog.EventTimestamp, sinceMs)),
    )
    .orderBy(eventLog.TenantId)
    .build();
  return { statement, declaresFullScan: true as const };
}

/** Every event of the discovered aggregates, across all history, as replay applies them. */
export function discoveredEventCountRead({
  eventTypes,
  sinceMs,
  tenantId,
}: {
  eventTypes: readonly string[];
  sinceMs: number;
  tenantId?: string | undefined;
}) {
  const aggregateKey = () => fn.tuple(eventLog.AggregateType, eventLog.AggregateId);
  const statement = clickhouseRead({ scope: replayScope(tenantId) })
    .from(eventLog)
    .with("discovered", (sub) =>
      sub
        .from(eventLog)
        .select({ aggregateKey: aggregateKey() })
        .where(({ and, gte, oneOf }) =>
          and(oneOf(eventLog.EventType, eventTypes), gte(eventLog.EventTimestamp, sinceMs)),
        ),
    )
    .select({ totalEvents: fn.count() })
    .where(({ and, oneOf }) =>
      and(oneOf(eventLog.EventType, eventTypes), oneOf(aggregateKey(), { cte: "discovered" })),
    )
    .build();
  return { statement, declaresFullScan: true as const };
}

/** The occurred-at span of a batch's aggregates over all their events; later reads prune by it. */
export function occurredAtBoundsRead({
  tenantId,
  aggregateTypes,
  aggregateIds,
}: {
  tenantId: string;
  aggregateTypes: readonly string[];
  aggregateIds: readonly string[];
}) {
  const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(eventLog)
    .select({
      cnt: fn.count(),
      minOccurredAt: fn.min(eventLog.EventOccurredAt),
      maxOccurredAt: fn.max(eventLog.EventOccurredAt),
    })
    .where(({ and, oneOf }) =>
      and(oneOf(eventLog.AggregateType, aggregateTypes), oneOf(eventLog.AggregateId, aggregateIds)),
    )
    .build();
  return { statement, declaresFullScan: true as const };
}

/** Each aggregate's last event of the types, by timestamp then id: where live takes over. */
export function cutoffEventsRead({
  tenantId,
  aggregateIds,
  eventTypes,
  occurredAtBounds,
}: {
  tenantId: string;
  aggregateIds: readonly string[];
  eventTypes: readonly string[];
  occurredAtBounds: OccurredAtBounds | undefined;
}) {
  const read = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(eventLog)
    .select({
      aggregateType: eventLog.AggregateType,
      aggregateId: eventLog.AggregateId,
      cutoffEventId: fn.argMax(
        eventLog.EventId,
        fn.tuple(eventLog.EventTimestamp, eventLog.EventId),
      ),
      cutoffTimestamp: fn.max(eventLog.EventTimestamp),
    })
    .where(({ and, oneOf }) =>
      and(oneOf(eventLog.EventType, eventTypes), oneOf(eventLog.AggregateId, aggregateIds)),
    );
  const pruned =
    occurredAtBounds === undefined
      ? read
      : read.where((ops) => occurredWithin(ops, occurredAtBounds));
  return { statement: pruned.groupBy(eventLog.AggregateType, eventLog.AggregateId).build() };
}

/** One page of a batch's events up to the max cutoff, strictly after the cursor. */
export function aggregateEventsPageRead({
  tenantId,
  aggregateIds,
  eventTypes,
  maxCutoff,
  cursor,
  batchSize,
  occurredAtBounds,
}: {
  tenantId: string;
  aggregateIds: readonly string[];
  eventTypes: readonly string[];
  maxCutoff: CutoffInfo;
  cursor: CutoffInfo | undefined;
  batchSize: number;
  occurredAtBounds: OccurredAtBounds | undefined;
}) {
  const upTo = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(eventLog)
    .select(REPLAY_ROW)
    .where(({ and, eq, lt, lte, oneOf, or }) =>
      and(
        oneOf(eventLog.EventType, eventTypes),
        oneOf(eventLog.AggregateId, aggregateIds),
        or(
          lt(eventLog.EventTimestamp, maxCutoff.timestamp),
          and(
            eq(eventLog.EventTimestamp, maxCutoff.timestamp),
            lte(eventLog.EventId, maxCutoff.eventId),
          ),
        ),
      ),
    );
  const after =
    cursor === undefined
      ? upTo
      : upTo.where(({ and, eq, gt, or }) =>
          or(
            gt(eventLog.EventTimestamp, cursor.timestamp),
            and(
              eq(eventLog.EventTimestamp, cursor.timestamp),
              gt(eventLog.EventId, cursor.eventId),
            ),
          ),
        );
  const pruned =
    occurredAtBounds === undefined
      ? after
      : after.where((ops) => occurredWithin(ops, occurredAtBounds));
  return {
    statement: pruned
      .orderBy(eventLog.EventTimestamp)
      .orderBy(eventLog.EventId)
      .limit(batchSize)
      .build(),
  };
}

/** Every event of a batch's aggregates in per-aggregate replay order, streamed batch by batch. */
export function streamedEventsRead({
  tenantId,
  aggregateIds,
  eventTypes,
  occurredAtBounds,
}: {
  tenantId: string;
  aggregateIds: readonly string[];
  eventTypes: readonly string[];
  occurredAtBounds: OccurredAtBounds | undefined;
}) {
  const read = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(eventLog)
    .select(REPLAY_ROW)
    .where(({ and, oneOf }) =>
      and(oneOf(eventLog.EventType, eventTypes), oneOf(eventLog.AggregateId, aggregateIds)),
    );
  const pruned =
    occurredAtBounds === undefined
      ? read
      : read.where((ops) => occurredWithin(ops, occurredAtBounds));
  return {
    statement: pruned
      .orderBy(eventLog.AggregateId)
      .orderBy(eventLog.EventTimestamp)
      .orderBy(eventLog.EventId)
      .build(),
  };
}
