/**
 * The event log's aggregate index (goose 00111; dev/docs/plans/id-index-2026-10-10.md §4): per
 * aggregate, its events' occurred-time span. Ops declares it, so the framework fills it
 * (`ops:fill-event-log-id-index`).
 */
import {
  defineIdIndex,
  type IdIndexDeclaration,
  type IdIndexFillClient,
  type IdIndexReader,
  IdIndexReadiness,
  idIndexReadinessTargets,
} from "@langwatch/clickhouse-client";

import { incrementEventLogIndexRead } from "../../metrics.ts";
import type { EventTable } from "./event-table-declarations.ts";

const EVENT_LOG_ID_INDEX_TABLE = "event_log_id_index" satisfies EventTable["table"];

/** What the fill walks: rows with no occurred time (0) stay out, as in the view. */
export const EVENT_LOG_ID_INDEX: IdIndexDeclaration = defineIdIndex({
  source: "event_log",
  key: ["AggregateType", "AggregateId"],
  time: "EventOccurredAt",
  filter: "EventOccurredAt > 0",
  timeFormat: "epoch_ms",
});

/**
 * Whether the index is filled on a ClickHouse target, answered from memory: one port the
 * composition supplies; none supplied reads as not ready.
 */
export interface EventLogIndexReadiness {
  isReady(input: { target: string }): boolean;
}

/**
 * The index's readiness from its marker row (id-index plan §2), every aggregate type at once:
 * the fill writes it, or the first check writes it over an empty event log. Each target the
 * routed client answers for is checked at boot.
 */
export function eventLogIdIndexReadiness({
  clickhouse,
}: {
  clickhouse: IdIndexFillClient;
}): EventLogIndexReadiness & Pick<IdIndexReadiness, "check"> {
  const readiness = IdIndexReadiness.create({
    statements: clickhouse,
    indexes: [EVENT_LOG_ID_INDEX],
    watch: () => idIndexReadinessTargets({ privateRoutes: clickhouse.privateRoutes() }),
  });
  return {
    isReady: ({ target }) => readiness.isOn({ target }),
    check: ({ target }) => readiness.check({ target }),
  };
}

/** The index a reader of the event log may consult: who answers it, and whether it is ready. */
export type EventLogIdIndex = Readonly<{
  reader: IdIndexReader;
  readiness: EventLogIndexReadiness;
}>;

/** The occurred-time span, epoch ms, the index holds for every non-zero event of the aggregates. */
export type EventLogOccurredRange = Readonly<{ fromMs: number; toMs: number }>;

/** Which read asked, for `es_event_log_index_read_total`. */
export type EventLogIndexRead = "aggregate" | "event" | "replay";

/**
 * The span to bound a read of these aggregates by, or null for today's unbounded read: no index,
 * an index not ready on the tenant's target, or an aggregate the index has not seen.
 */
export async function eventLogOccurredRange({
  index,
  read,
  tenantId,
  aggregateTypes,
  aggregateIds,
}: {
  index: EventLogIdIndex | undefined;
  read: EventLogIndexRead;
  tenantId: string;
  aggregateTypes: readonly string[];
  aggregateIds: readonly string[];
}): Promise<EventLogOccurredRange | null> {
  const types = [...new Set(aggregateTypes)];
  if (index === undefined || types.length === 0 || aggregateIds.length === 0) return null;
  const target = await index.reader.targetOf({ tenantId });
  if (!index.readiness.isReady({ target })) {
    incrementEventLogIndexRead({ read, outcome: "unindexed" });
    return null;
  }
  const bounds = await index.reader.indexBounds({
    tenantId,
    index: EVENT_LOG_ID_INDEX_TABLE,
    key: { AggregateType: types, AggregateId: aggregateIds },
    timeFormat: "epoch_ms",
  });
  incrementEventLogIndexRead({ read, outcome: bounds.n === 0 ? "index_miss" : "index_hit" });
  return bounds.n === 0 ? null : { fromMs: bounds.fromMs, toMs: bounds.toMs };
}
