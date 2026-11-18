import {
  clickhouseRead,
  type Condition,
  fn,
  type ReadOps,
  type ReaderReadStatement,
  type ReaderScope,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";

import type { EventLogPageCursor } from "../../../stores/event-log-page-order.ts";
import type { EventOccurredAtWindow } from "../../../stores/repositories/eventRepository.types.ts";
import { eventLog } from "./event-log-table.clickhouse.ts";

/** The `event_log` columns the row mapper reads, shared by every aggregate read. */
const EVENT_LOG_ROW = {
  EventId: eventLog.EventId,
  EventTimestamp: eventLog.EventTimestamp,
  EventOccurredAt: eventLog.EventOccurredAt,
  EventType: eventLog.EventType,
  EventPayload: eventLog.EventPayload,
  EventVersion: eventLog.EventVersion,
  ProcessingTraceparent: eventLog.ProcessingTraceparent,
  IdempotencyKey: eventLog.IdempotencyKey,
};

type Ops = ReadOps<ReaderScope, "event_log", never>;
type EventLogCondition = Condition<"event_log">;

/** A built read and, when it walks an aggregate's whole history, its declared full scan. */
export interface EventLogRead<Row> {
  readonly statement: ReaderReadStatement<Row>;
  readonly declaresFullScan?: true;
}

/** A positive lower bound prunes weekly partitions; unknown-time rows (0) are always kept. */
function occurredSince(
  { eq, gte, or }: Pick<Ops, "eq" | "gte" | "or">,
  fromMs: number,
): EventLogCondition {
  return or(eq(eventLog.EventOccurredAt, 0), gte(eventLog.EventOccurredAt, fromMs));
}

function hasLowerBound(fromMs: number | undefined): fromMs is number {
  return typeof fromMs === "number" && fromMs > 0;
}

/** One event by id, newest first; a window bounds `EventOccurredAt` both ways, 0 kept. */
export function eventRecordRead({
  tenantId,
  aggregateType,
  aggregateId,
  eventId,
  window,
}: {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventId: string;
  window: EventOccurredAtWindow | undefined;
}) {
  const read = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(eventLog)
    .select(EVENT_LOG_ROW)
    .where(({ and, eq }) =>
      and(
        eq(eventLog.AggregateType, aggregateType),
        eq(eventLog.AggregateId, aggregateId),
        eq(eventLog.EventId, eventId),
      ),
    );
  const windowed =
    window === undefined
      ? read
      : read.where(({ and, eq, gte, lte, or }) =>
          or(
            eq(eventLog.EventOccurredAt, 0),
            and(
              gte(eventLog.EventOccurredAt, window.fromMs),
              lte(eventLog.EventOccurredAt, window.toMs),
            ),
          ),
        );
  return { statement: windowed.orderBy(eventLog.EventTimestamp, "DESC").limit(1).build() };
}

/** One aggregate's events in acceptance order; unbounded, a fold reads its whole history. */
export function aggregateEventsRead({
  tenantId,
  aggregateType,
  aggregateId,
  occurredAtFromMs,
}: {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  occurredAtFromMs: number | undefined;
}) {
  const read = aggregateRead({ tenantId, aggregateType, aggregateId, occurredAtFromMs });
  return fullScanUnless(occurredAtFromMs, {
    statement: read.orderBy(eventLog.EventTimestamp).orderBy(eventLog.EventId).build(),
  });
}

/** Many aggregates' events across a declared tenant set, each in acceptance order. */
export function eventsOfAggregatesRead({
  tenantIds,
  aggregateType,
  aggregateIds,
  occurredAtFromMs,
}: {
  tenantIds: readonly string[];
  aggregateType: string;
  aggregateIds: readonly string[];
  occurredAtFromMs: number | undefined;
}) {
  const read = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
    .from(eventLog)
    .select({ TenantId: eventLog.TenantId, AggregateId: eventLog.AggregateId, ...EVENT_LOG_ROW })
    .where(({ and, eq, oneOf }) =>
      and(eq(eventLog.AggregateType, aggregateType), oneOf(eventLog.AggregateId, aggregateIds)),
    );
  const bounded = hasLowerBound(occurredAtFromMs)
    ? read.where((ops) => occurredSince(ops, occurredAtFromMs))
    : read;
  return fullScanUnless(occurredAtFromMs, {
    statement: bounded
      .orderBy(eventLog.TenantId)
      .orderBy(eventLog.AggregateId)
      .orderBy(eventLog.EventTimestamp)
      .orderBy(eventLog.EventId)
      .build(),
  });
}

/**
 * One aggregate's events up to and including an event, in acceptance order. A page reads in
 * page order (see {@link EventLogPageCursor}) from a strict `after` cursor under a row cap, so
 * a re-fold streams a huge aggregate's history through the primary index.
 */
export function aggregateEventsUpToRead({
  tenantId,
  aggregateType,
  aggregateId,
  upToTimestamp,
  upToEventId,
  occurredAtFromMs,
  page,
}: {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  upToTimestamp: number;
  upToEventId: string;
  occurredAtFromMs: number | undefined;
  page?: { after: EventLogPageCursor | undefined; limit: number };
}) {
  const upTo = aggregateRead({ tenantId, aggregateType, aggregateId, occurredAtFromMs }).where(
    ({ and, eq, lt, lte, or }) =>
      or(
        lt(eventLog.EventTimestamp, upToTimestamp),
        and(eq(eventLog.EventTimestamp, upToTimestamp), lte(eventLog.EventId, upToEventId)),
      ),
  );
  if (page === undefined) {
    return fullScanUnless(occurredAtFromMs, {
      statement: upTo.orderBy(eventLog.EventTimestamp).orderBy(eventLog.EventId).build(),
    });
  }
  // The `>=` conjunct is the one the primary index seeks on; arrival and id only order copies
  // of one key that are not merged yet, so none is skipped.
  const after = page.after;
  const paged =
    after === undefined
      ? upTo
      : upTo
          .where(({ gte }) => gte(eventLog.IdempotencyKey, after.idempotencyKey))
          .where(({ and, eq, gt, or }) =>
            or(
              gt(eventLog.IdempotencyKey, after.idempotencyKey),
              gt(eventLog.EventTimestamp, after.timestamp),
              and(
                eq(eventLog.EventTimestamp, after.timestamp),
                gt(eventLog.EventId, after.eventId),
              ),
            ),
          );
  const ordered = paged
    .orderBy(eventLog.IdempotencyKey)
    .orderBy(eventLog.EventTimestamp)
    .orderBy(eventLog.EventId);
  return fullScanUnless(occurredAtFromMs, { statement: ordered.limit(page.limit).build() });
}

/** The distinct events of an aggregate accepted strictly before an event. */
export function eventCountBeforeRead({
  tenantId,
  aggregateType,
  aggregateId,
  beforeTimestamp,
  beforeEventId,
  occurredAtFromMs,
}: {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  beforeTimestamp: number;
  beforeEventId: string;
  occurredAtFromMs: number | undefined;
}) {
  const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(eventLog)
    .select({ count: fn.countDistinct(eventLog.EventId) })
    .where(({ and, eq }) =>
      and(eq(eventLog.AggregateType, aggregateType), eq(eventLog.AggregateId, aggregateId)),
    );
  const bounded =
    occurredAtFromMs === undefined
      ? statement
      : statement.where((ops) => occurredSince(ops, occurredAtFromMs));
  return {
    statement: bounded
      .where(({ and, eq, lt, ne, or }) =>
        and(
          or(
            lt(eventLog.EventTimestamp, beforeTimestamp),
            and(eq(eventLog.EventTimestamp, beforeTimestamp), lt(eventLog.EventId, beforeEventId)),
          ),
          ne(eventLog.EventId, beforeEventId),
        ),
      )
      .build(),
  };
}

/**
 * The two existence checks a fold asks after a store miss, each stopping at its first row: the
 * delivered event, and an event accepted before it other than the ignored ones.
 */
export function eventProbeReads({
  tenantId,
  aggregateType,
  aggregateId,
  eventTimestamp,
  eventId,
  occurredAtFromMs,
  ignoreEventIds,
}: {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventTimestamp: number;
  eventId: string;
  occurredAtFromMs: number | undefined;
  ignoreEventIds: readonly string[];
}) {
  const keyed = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(eventLog)
    .select({ EventId: eventLog.EventId })
    .where(({ and, eq }) =>
      and(eq(eventLog.AggregateType, aggregateType), eq(eventLog.AggregateId, aggregateId)),
    );
  const bounded = hasLowerBound(occurredAtFromMs)
    ? keyed.where((ops) => occurredSince(ops, occurredAtFromMs))
    : keyed;
  const earlier = bounded.where(({ and, eq, lt, ne, or }) =>
    and(
      or(
        lt(eventLog.EventTimestamp, eventTimestamp),
        and(eq(eventLog.EventTimestamp, eventTimestamp), lt(eventLog.EventId, eventId)),
      ),
      ne(eventLog.EventId, eventId),
    ),
  );
  const unignored =
    ignoreEventIds.length === 0
      ? earlier
      : earlier.where(({ not, oneOf }) => not(oneOf(eventLog.EventId, ignoreEventIds)));
  return {
    event: fullScanUnless(occurredAtFromMs, {
      statement: bounded
        .where(({ eq }) => eq(eventLog.EventId, eventId))
        .limit(1)
        .build(),
    }),
    earlier: fullScanUnless(occurredAtFromMs, { statement: unignored.limit(1).build() }),
  };
}

/** The aggregate's key and, when positive, its lower bound on the partition key. */
function aggregateRead({
  tenantId,
  aggregateType,
  aggregateId,
  occurredAtFromMs,
}: {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  occurredAtFromMs: number | undefined;
}) {
  const read = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(eventLog)
    .select(EVENT_LOG_ROW)
    .where(({ and, eq }) =>
      and(eq(eventLog.AggregateType, aggregateType), eq(eventLog.AggregateId, aggregateId)),
    );
  return hasLowerBound(occurredAtFromMs)
    ? read.where((ops) => occurredSince(ops, occurredAtFromMs))
    : read;
}

function fullScanUnless<Row>(
  occurredAtFromMs: number | undefined,
  read: { statement: ReaderReadStatement<Row> },
): EventLogRead<Row> {
  return hasLowerBound(occurredAtFromMs) ? read : { ...read, declaresFullScan: true };
}
