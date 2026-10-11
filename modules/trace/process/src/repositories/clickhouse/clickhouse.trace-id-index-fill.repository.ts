import {
  type ClickHouseQueryClient,
  fillIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  idIndexFillTargets,
} from "@langwatch/clickhouse-client";

import {
  TraceIdIndexFillRepository,
  type TraceIdIndexFillInput,
} from "../trace-id-index-fill.repository.ts";

/** The `trace_summaries` id index, as goose `00110_trace_id_indexes.sql` creates it. */
export const TRACE_SUMMARIES_ID_INDEX = "trace_summaries_id_index";
export const STORED_SPANS_ID_INDEX = "stored_spans_id_index";
export const TRACE_ANALYTICS_ID_INDEX = "trace_analytics_id_index";

/** Trace's id indexes as goose 00110 declares them (dev/docs/plans/id-index-2026-10-10.md §1). */
export const TRACE_ID_INDEXES: readonly IdIndexDeclaration[] = [
  {
    source: "trace_summaries",
    index: TRACE_SUMMARIES_ID_INDEX,
    key: ["TraceId"],
    time: "OccurredAt",
    retentionAnchor: "OccurredAt",
    retention: "copied",
  },
  {
    source: "stored_spans",
    index: STORED_SPANS_ID_INDEX,
    key: ["TraceId"],
    time: "StartTime",
    retentionAnchor: "StartTime",
    retention: "copied",
  },
  {
    source: "trace_analytics",
    index: TRACE_ANALYTICS_ID_INDEX,
    key: ["TraceId"],
    time: "OccurredAt",
    retentionAnchor: "OccurredAt",
    retention: "copied",
  },
];

/** Fills trace's id indexes on the shared target, then each private route's server. */
export class ClickHouseTraceIdIndexFillRepository extends TraceIdIndexFillRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseTraceIdIndexFillRepository {
    return new ClickHouseTraceIdIndexFillRepository(clickhouse);
  }

  fill({
    checkpoint,
    signal,
    dryRun,
    beforeFlag,
    setFlag,
  }: TraceIdIndexFillInput): Promise<IdIndexFillReport> {
    const copied = TRACE_ID_INDEXES.filter((index) => index.retention === "copied").map(
      (index) => index.index,
    );
    return fillIdIndexes({
      statements: this.#clickhouse,
      targets: idIndexFillTargets({ privateRoutes: this.#clickhouse.privateRoutes() }),
      indexes: TRACE_ID_INDEXES,
      checkpoint,
      signal,
      dryRun,
      beforeFlag: ({ target }) =>
        beforeFlag({ organizationId: target.organizationId, indexes: copied }),
      setFlag,
    });
  }
}
