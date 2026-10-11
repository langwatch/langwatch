/**
 * The event log's aggregate index (goose 00111; dev/docs/plans/id-index-2026-10-10.md §4): per
 * aggregate, its events' occurred-time span. Ops hosts its fill (`ops:fill-event-log-id-index`).
 */
import {
  type FillIdIndexesOptions,
  fillIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  idIndexFillTargets,
  type IdIndexFlags,
  type IdIndexReader,
  type IdIndexStatements,
} from "@langwatch/clickhouse-client";

import { incrementEventLogIndexRead } from "../../metrics.ts";
import type { EventTable } from "./event-table-declarations.ts";

const EVENT_LOG_ID_INDEX_TABLE = "event_log_id_index" satisfies EventTable["table"];

/** The owner its flags are keyed by: `clickhouse_id_index_eventing_<target>`. */
export const EVENT_LOG_ID_INDEX_OWNER = "eventing";

/** What the fill walks: rows with no occurred time (0) stay out, as in the view. */
export const EVENT_LOG_ID_INDEX: IdIndexDeclaration = {
  source: "event_log",
  index: EVENT_LOG_ID_INDEX_TABLE,
  key: ["AggregateType", "AggregateId"],
  time: "EventOccurredAt",
  retentionAnchor: "EventOccurredAt",
  retention: "copied",
  filter: "EventOccurredAt > 0",
};

/**
 * Whether the index is filled for an aggregate type on a ClickHouse target, answered from memory.
 * One port the composition supplies, whatever answers it; none supplied reads as not ready.
 */
export interface EventLogIndexReadiness {
  isReady(input: { target: string; aggregateType: string }): boolean;
}

/** Readiness from flags each pipeline declared with `.withEventLogIndex`; none reads as off. */
export function pipelineFlagReadiness({
  flagsFor,
}: {
  flagsFor: (aggregateType: string) => IdIndexFlags | undefined;
}): EventLogIndexReadiness {
  return {
    isReady: ({ target, aggregateType }) => flagsFor(aggregateType)?.isOn({ target }) === true,
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
 * a type whose flag is off on the tenant's target, or an aggregate the index has not seen.
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
  if (!types.every((aggregateType) => index.readiness.isReady({ target, aggregateType }))) {
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

/** The statements and routes the fill runs over: the routed ClickHouse member. */
export type EventLogIdIndexFillClient = IdIndexStatements & {
  privateRoutes(): ReadonlyMap<string, string>;
};

/** Fills the index on the shared server and every private one from rows older than its view. */
export class EventingClickHouseEventLogIdIndexFill {
  static create({
    clickhouse,
  }: {
    clickhouse: EventLogIdIndexFillClient;
  }): EventingClickHouseEventLogIdIndexFill {
    return new EventingClickHouseEventLogIdIndexFill(clickhouse);
  }

  private constructor(private readonly clickhouse: EventLogIdIndexFillClient) {}

  /** The index whose rows copy `_retention_days`, raised by data-retention before each flag. */
  indexesWithCopiedRetention(): string[] {
    return [EVENT_LOG_ID_INDEX.index];
  }

  fill(
    input: Omit<FillIdIndexesOptions, "statements" | "targets" | "indexes">,
  ): Promise<IdIndexFillReport> {
    return fillIdIndexes({
      ...input,
      indexes: [EVENT_LOG_ID_INDEX],
      statements: this.clickhouse,
      targets: idIndexFillTargets({ privateRoutes: this.clickhouse.privateRoutes() }),
    });
  }
}
