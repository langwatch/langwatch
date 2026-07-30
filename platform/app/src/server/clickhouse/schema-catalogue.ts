/**
 * The one description of our ClickHouse tables.
 *
 * Three hand-kept copies of "which column does this table partition on" had
 * drifted apart before this file existed: the runtime cold-scan detector knew
 * 11 of the 33 tables, a facet registry knew 3, and the written guidance in
 * `dev/docs/best_practices/clickhouse-queries.md` named the wrong partition
 * column for `evaluation_runs` and the wrong dedup key for `simulation_runs`.
 * None of them ever went red, because nothing compared them to the migrations.
 *
 * So: one catalogue, and `__tests__/schema-catalogue.drift.unit.test.ts`
 * compares every mechanical field in it to the DDL and fails on any
 * disagreement. Adding a table to the migrations without adding it here is a
 * failing test, which is the property the three older copies never had.
 *
 * ## What is checked and what is asserted
 *
 * Every field here except one is read back out of the migrations and compared.
 * The exception is {@link TableShape.partitionColumnStability}, which no parser
 * can derive: it describes what the code that WRITES the table does, not what
 * the DDL says. It is asserted by a person, and the test can only require that
 * it is declared and reasoned. See the type's own docs — it is the field most
 * likely to be wrong and the most expensive to be wrong about.
 *
 * ## Consumers
 *
 * The runtime convention gate reads {@link partitionColumnOf} and
 * {@link tenantColumnsOf} on every query. Fold-store libraries and repositories
 * that need to know a table's version column or sort key should read them from
 * here rather than restating them; a restatement is a fourth copy waiting to
 * drift.
 */

/**
 * Whether a row's partition column can change value after the row first
 * exists — the one field a human asserts.
 *
 * Two tables can carry an identically-named partition column and behave
 * completely differently, and the DDL cannot tell you which you have:
 *
 *  - `trace_analytics.OccurredAt` is FROZEN. ADR-071 made it a storage anchor:
 *    written once, from the first business time the fold observed, and never
 *    moved again. It anchors the row's partition, its place in the sort key and
 *    its TTL deadline for life.
 *  - `evaluation_analytics.OccurredAt` MOVES. Migration 00041 stamps it from
 *    the latest event's `occurredAt`, so it advances as an evaluation
 *    progresses and the row migrates between partitions behind it.
 *
 * The two tables were created three migrations apart, partition on identically
 * spelled expressions, and one of them will silently drop rows out of a
 * time-bounded dedup subquery. That is the cost of getting this wrong, and it
 * is why `"unverified"` exists: a confident wrong answer here is unfalsifiable,
 * because the drift test can only check that the field is declared.
 */
export type PartitionColumnStability =
  /**
   * A later write for the same sort key cannot carry a different value. Range
   * predicates on this column are safe in both the outer scope and a dedup
   * subquery.
   */
  | "frozen"
  /**
   * A later write can carry a different value, so the row can move partitions
   * (or, where the column is in the sort key, orphan its earlier version).
   * Bound the outer scope on it for pruning; NEVER bound a dedup subquery on
   * it — the true latest version drops out of its own group the moment it
   * drifts past the window edge, and the group resolves to a stale in-window
   * version that is non-null and plausible. See
   * `dev/docs/best_practices/clickhouse-queries.md`.
   */
  | "movable"
  /**
   * Not yet established. Treat as {@link "movable"} — the conservative
   * reading — until someone traces the writer and says which it is.
   *
   * This is a real state, not a placeholder to be cleared by guessing. Each
   * entry carrying it names in its rationale exactly what has to be checked.
   */
  | "unverified";

/** The rules the runtime gate counts violations of. */
export type ConventionRule =
  /** Read of a partitioned table with no filter on its partition column. */
  | "partition_predicate"
  /** Read of a table with no comparison on any of its tenant columns. */
  | "tenant_predicate";

/** One table, as the migrations define it plus the one asserted field. */
export interface TableShape {
  /**
   * The `PARTITION BY` expression, verbatim from the DDL.
   *
   * Verbatim rather than reduced to a column: `toYearWeek(toDate(BucketStart))`
   * and `toYearWeek(BucketStart)` prune differently at the edges, and a
   * catalogue that called both `BucketStart` would describe two different
   * tables identically.
   */
  readonly partitionExpression: string;
  /**
   * The column inside {@link partitionExpression} that a WHERE predicate must
   * compare in order to prune. The drift test requires it to appear in the
   * expression.
   */
  readonly partitionColumn: string;
  /**
   * Further columns whose predicate ALSO prunes, because they are derived from
   * and monotonic in the partition column. `AcceptedHour` is the hour bucket of
   * `AcceptedAt`, so a range on it bounds the partition just as well.
   *
   * Only correlated columns belong here. An unrelated column does not prune,
   * and listing one silently blinds the gate for that table.
   */
  readonly prunableColumns?: readonly string[];
  /** See {@link PartitionColumnStability}. Asserted, not derived. */
  readonly partitionColumnStability: PartitionColumnStability;
  /**
   * Why {@link partitionColumnStability} is what it says, citing the migration,
   * ADR or writer it was read off. Required: an assertion nobody can retrace is
   * an assertion nobody can correct.
   */
  readonly stabilityRationale: string;
  /** The engine's `ORDER BY` tuple, in order — the dedup key. */
  readonly sortKey: readonly string[];
  /**
   * The `ReplacingMergeTree(<col>)` version column, or null for engines without
   * one (AggregatingMergeTree). This is the column `argMax(…, <version>)` must
   * dedup on.
   */
  readonly versionColumn: string | null;
  /**
   * Columns any one of which scopes a read to a tenant. Usually just
   * `TenantId`. A table listing more than one leads its sort key with the
   * broader scope, so a query scoped on either prunes — see the per-entry note.
   */
  readonly tenantColumns: readonly string[];
  /**
   * Columns whose values are large enough that materialising them across a
   * granule is the cost that matters. Drives the per-key-limit rule: taking
   * several rows per key forces ClickHouse to materialise these for whole
   * granules rather than the rows actually selected.
   */
  readonly heavyColumns: readonly string[];
}

/**
 * Every table the migrations leave in place, keyed by unqualified name.
 *
 * 33 entries against 35 live `PARTITION BY` clauses in the DDL. The two extra
 * clauses belong to tables that no longer exist: `gateway_activity_events`
 * (created 00029, dropped 00030) and `gateway_budget_scope_totals_rebuild`
 * (created, EXCHANGEd into the live rollup and dropped, all within 00058).
 * Counting clauses gives 35; counting tables gives 33.
 */
export const SCHEMA_CATALOGUE = {
  // ---------------------------------------------------------------------
  // Event and span storage — append-only, so the partition column is the
  // row's own immutable business time.
  // ---------------------------------------------------------------------

  event_log: {
    partitionExpression: "toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))",
    partitionColumn: "EventOccurredAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "An event's occurrence time is a property of the event. The sort key ends in IdempotencyKey (00002), so a replay of the same event rewrites the same row with the same EventOccurredAt rather than moving it.",
    sortKey: ["TenantId", "AggregateType", "AggregateId", "IdempotencyKey"],
    versionColumn: "EventTimestamp",
    tenantColumns: ["TenantId"],
    heavyColumns: ["EventPayload"],
  },

  stored_spans: {
    partitionExpression: "toYearWeek(StartTime)",
    partitionColumn: "StartTime",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "dev/docs/best_practices/clickhouse-queries.md states it outright: StartTime is the span's own business time and is unchanged when an emitter re-reports a span. That is also why the doc tells you to dedup on UpdatedAt rather than the engine's declared version column.",
    sortKey: ["TenantId", "TraceId", "SpanId"],
    // The engine declares ReplacingMergeTree(StartTime), but StartTime does not
    // advance between versions of a span, so it cannot order them. The doc's
    // standing warning is to dedup on UpdatedAt instead; this records the
    // column the DDL declares, and the drift test pins it to the DDL.
    versionColumn: "StartTime",
    tenantColumns: ["TenantId"],
    heavyColumns: ["SpanAttributes", "ResourceAttributes"],
  },

  stored_log_records: {
    partitionExpression: "toYearWeek(TimeUnixMs)",
    partitionColumn: "TimeUnixMs",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "The log record's own emission time, and the sort key ends in ProjectionId (00002) so a re-projection rewrites the same row. A record does not change when it was emitted.",
    sortKey: ["TenantId", "TraceId", "SpanId", "ProjectionId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Body", "Attributes", "ResourceAttributes"],
  },

  stored_metric_records: {
    partitionExpression: "toYearWeek(TimeUnixMs)",
    partitionColumn: "TimeUnixMs",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "The metric record's own emission time, keyed through ProjectionId (00002) so a re-projection rewrites the same row rather than moving it.",
    sortKey: ["TenantId", "TraceId", "SpanId", "MetricName", "ProjectionId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Attributes", "ResourceAttributes"],
  },

  // ---------------------------------------------------------------------
  // Canonical OTLP storage — the point's own timestamp, and in the sort key.
  // ---------------------------------------------------------------------

  metric_data_points: {
    partitionExpression: "toYearWeek(TimeUnixMs)",
    partitionColumn: "TimeUnixMs",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "TimeUnixMs is part of the sort key (00049), so it identifies the point rather than describing it — a different value is a different row, not a moved one.",
    sortKey: ["TenantId", "SeriesId", "TimeUnixMs", "TimeUnixNano", "PointId"],
    versionColumn: "DedupVersion",
    tenantColumns: ["TenantId"],
    heavyColumns: [
      "ResourceAttributesJson",
      "PointAttributesJson",
      "SummaryQuantilesJson",
      "CanonicalPayload",
    ],
  },

  metric_series: {
    partitionExpression: "toYearWeek(LastSeenAt)",
    partitionColumn: "LastSeenAt",
    partitionColumnStability: "movable",
    stabilityRationale:
      "LastSeenAt is re-stamped every time the series is seen again — that is what the name means — and the sort key is only (TenantId, SeriesId) (00049), so the row itself migrates forward through partitions for as long as the series stays live.",
    sortKey: ["TenantId", "SeriesId"],
    versionColumn: "LastSeenAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["ResourceAttributesJson", "PointAttributesJson"],
  },

  metric_time_rollups: {
    partitionExpression: "toYearWeek(BucketStart)",
    partitionColumn: "BucketStart",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "BucketStart is part of the sort key (00049) and is the bucket's own boundary — a rollup row belongs to one bucket by construction and cannot be re-bucketed in place.",
    sortKey: ["TenantId", "SeriesId", "BucketStart"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  metric_usage_estimates: {
    partitionExpression: "toYYYYMM(AcceptedAt)",
    partitionColumn: "AcceptedAt",
    prunableColumns: ["AcceptedHour"],
    partitionColumnStability: "frozen",
    stabilityRationale:
      "The moment ingest accepted the point. Keyed by PointId (00049); a re-write of the same point is the same acceptance.",
    sortKey: ["OrganizationId", "TenantId", "PointId"],
    versionColumn: "DedupVersion",
    // Leads OrganizationId, and the sort key agrees, so an org-scoped read of
    // this table prunes properly and is not a missing-tenant-filter bug. This
    // is the structural carve-out the audit found undocumented.
    tenantColumns: ["TenantId", "OrganizationId"],
    heavyColumns: [],
  },

  log_records: {
    partitionExpression: "toYearWeek(TimeUnixMs)",
    partitionColumn: "TimeUnixMs",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "TimeUnixMs is part of the sort key (00050), so it identifies the record rather than describing it.",
    sortKey: ["TenantId", "CorrelationTraceId", "TimeUnixMs", "RecordId"],
    versionColumn: "DedupVersion",
    tenantColumns: ["TenantId"],
    heavyColumns: [
      "ResourceAttributesJson",
      "AttributesJson",
      "BodyJson",
      "BodyText",
      "CanonicalPayload",
    ],
  },

  log_usage_estimates: {
    partitionExpression: "toYYYYMM(AcceptedAt)",
    partitionColumn: "AcceptedAt",
    prunableColumns: ["AcceptedHour"],
    partitionColumnStability: "frozen",
    stabilityRationale:
      "The moment ingest accepted the record. Keyed by RecordId (00050); a re-write of the same record is the same acceptance.",
    sortKey: ["OrganizationId", "TenantId", "RecordId"],
    versionColumn: "DedupVersion",
    // Same structural org-leading shape as metric_usage_estimates.
    tenantColumns: ["TenantId", "OrganizationId"],
    heavyColumns: [],
  },

  // ---------------------------------------------------------------------
  // Billing and governance — immutable events.
  // ---------------------------------------------------------------------

  billable_events: {
    partitionExpression: "toYYYYMM(EventTimestamp)",
    partitionColumn: "EventTimestamp",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "A billing event's timestamp is the event. The sort key ends in DeduplicationKeyHash (00002), so a replay collapses onto the same row with the same timestamp.",
    sortKey: ["OrganizationId", "TenantId", "DeduplicationKeyHash"],
    versionColumn: "UpdatedAt",
    // Leads OrganizationId and the sort key agrees: billing is settled per
    // organization, so an org-scoped read here is correct and prunes. The audit
    // found this sound but undocumented.
    tenantColumns: ["TenantId", "OrganizationId"],
    heavyColumns: [],
  },

  governance_ocsf_events: {
    partitionExpression: "toYYYYMM(EventTime)",
    partitionColumn: "EventTime",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "An audit event's time is a property of the event; 00026 keys the table by EventId and describes reads as an EventTime-ordered cursor scan, which only works because EventTime does not move.",
    sortKey: ["TenantId", "EventId"],
    versionColumn: "LastUpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["RawOcsfJson"],
  },

  governance_kpis: {
    partitionExpression: "toYYYYMM(HourBucket)",
    partitionColumn: "HourBucket",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "HourBucket is part of the sort key (00031, extended by 00063) and is a derived hour boundary — a row belongs to one hour by construction.",
    sortKey: ["TenantId", "SourceId", "HourBucket", "TraceId", "EventId"],
    versionColumn: "LastEventOccurredAt",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  // ---------------------------------------------------------------------
  // Gateway budget ledger.
  // ---------------------------------------------------------------------

  gateway_budget_ledger_events: {
    partitionExpression: "toYYYYMM(OccurredAt)",
    partitionColumn: "OccurredAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "One row per gateway request, keyed by GatewayRequestId. 00017 says the ORDER BY plus the dedup engine collapses replays safely, which requires the replay to carry the same OccurredAt.",
    sortKey: ["TenantId", "BudgetId", "GatewayRequestId"],
    versionColumn: "EventTimestamp",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  gateway_budget_scope_totals: {
    partitionExpression: "toYYYYMM(PeriodStart)",
    partitionColumn: "PeriodStart",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "PeriodStart is part of the sort key (00017, rebuilt by 00058) and is the budget window's own boundary — an aggregate row belongs to one period by construction.",
    sortKey: ["TenantId", "Scope", "ScopeId", "Window", "PeriodStart"],
    versionColumn: null,
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  // ---------------------------------------------------------------------
  // Analytics folds and rollups.
  // ---------------------------------------------------------------------

  trace_analytics: {
    partitionExpression: "toYearWeek(OccurredAt)",
    partitionColumn: "OccurredAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "ADR-071, implemented by 00061: OccurredAt carries the storage anchor — the first business time the fold observed from any contribution — and is frozen thereafter. The migration exists precisely because the column previously moved (it held min(span start) and drifted backwards on every late span), which orphaned row versions and dragged the TTL deadline.",
    sortKey: ["TenantId", "OccurredAt", "TraceId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Attributes"],
  },

  trace_analytics_rollup: {
    partitionExpression: "toYearWeek(toDate(BucketStart))",
    partitionColumn: "BucketStart",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "BucketStart is part of the sort key (00038) and is the bucket's own boundary; 00038 notes the partition deliberately matches the column the sort key leads on.",
    sortKey: ["TenantId", "BucketStart", "Model", "SpanType"],
    versionColumn: null,
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  evaluation_analytics: {
    partitionExpression: "toYearWeek(OccurredAt)",
    partitionColumn: "OccurredAt",
    partitionColumnStability: "movable",
    stabilityRationale:
      "00041 states it: OccurredAt is stamped from the latest event's occurredAt — for terminal events when the evaluator returned, otherwise the latest stage transition. So it advances as an evaluation progresses, and the row moves partitions behind it. Identical DDL shape to trace_analytics, opposite behaviour.",
    sortKey: ["TenantId", "OccurredAt", "EvaluationId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Attributes"],
  },

  evaluation_analytics_rollup: {
    partitionExpression: "toYearWeek(toDate(BucketStart))",
    partitionColumn: "BucketStart",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "BucketStart is part of the sort key (00040) and is the bucket's own boundary; 00040 notes the partition deliberately matches the column the sort key leads on.",
    sortKey: ["TenantId", "BucketStart", "EvaluatorType", "Status"],
    versionColumn: null,
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  langy_analytics_events: {
    partitionExpression: "toYearWeek(toDate(OccurredAt))",
    partitionColumn: "OccurredAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "OccurredAt is part of the sort key alongside EventId (00047), so it identifies the event rather than describing a mutable aggregate.",
    sortKey: ["TenantId", "OccurredAt", "EventId"],
    versionColumn: "ProjectedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  automation_audit: {
    partitionExpression: "toYearWeek(toDate(OccurredAt))",
    partitionColumn: "OccurredAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "OccurredAt is part of the sort key alongside EventId (00048), so it identifies the event. Note the projection that wrote this table was removed in #6064; the table is still in the DDL and its drop migration is pending.",
    sortKey: ["TenantId", "OccurredAt", "EventId"],
    versionColumn: "ProjectedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  // ---------------------------------------------------------------------
  // Coding-agent sessions.
  // ---------------------------------------------------------------------

  coding_agent_sessions: {
    partitionExpression: "toYearWeek(StartedAt)",
    partitionColumn: "StartedAt",
    partitionColumnStability: "movable",
    stabilityRationale:
      "dev/docs/best_practices/clickhouse-queries.md names coding_agent_sessions.StartedAt directly as a fold taking min/max over business time, and cites coding-agent-session.clickhouse.repository.ts (findManyRecent / findLatestRecord) as documenting both the rule and its scan cost. StartedAt is also in the sort key, so a move orphans the earlier version rather than relocating the row.",
    sortKey: ["TenantId", "StartedAt", "SessionId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Steps", "ToolCounts", "FilesTouched"],
  },

  coding_agent_trace_sessions: {
    partitionExpression: "toYYYYMM(OccurredAt)",
    partitionColumn: "OccurredAt",
    partitionColumnStability: "movable",
    stabilityRationale:
      "codingAgentTraceSessions.mapProjection.ts:44-64 stamps occurredAtMs from whichever span or log event is being mapped, so several contributions for one trace write different OccurredAt values under the same (TenantId, TraceId). The read path concedes this outright: coding-agent-trace-session.repository.ts:154 does ORDER BY OccurredAt DESC to pick among the versions.",
    sortKey: ["TenantId", "TraceId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  session_metric_series: {
    partitionExpression: "toYYYYMM(AsOf)",
    partitionColumn: "AsOf",
    partitionColumnStability: "movable",
    stabilityRationale:
      "AsOf is simultaneously the partition column and the engine's version column (00052), and a version column that did not advance between writes could not order them. The sort key is (TenantId, SessionId, SeriesId) and excludes AsOf, so each advance moves the row.",
    sortKey: ["TenantId", "SessionId", "SeriesId"],
    versionColumn: "AsOf",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  // ---------------------------------------------------------------------
  // Run and trace projections. These are folds whose partition columns are
  // written by application code rather than fixed by the event, so most of
  // them need the writer traced before a range predicate is safe.
  // ---------------------------------------------------------------------

  trace_summaries: {
    partitionExpression: "toYearWeek(OccurredAt)",
    partitionColumn: "OccurredAt",
    partitionColumnStability: "movable",
    stabilityRationale:
      "span-timing.service.ts:36-39 recomputes OccurredAt as a running min(state.occurredAt, span.startTimeUnixMs) on every span event, so a late span with an earlier start moves it backwards; written at trace-summary.clickhouse.repository.ts:493 under a sort key of only (TenantId, TraceId). Note that a comment in that repository calls OccurredAt stable across versions — that is an operating assumption of the read-path window, NOT what the fold guarantees, and this is the table whose slim successor needed ADR-071 to freeze the equivalent column.",
    sortKey: ["TenantId", "TraceId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Attributes", "ComputedInput", "ComputedOutput"],
  },

  evaluation_runs: {
    partitionExpression: "toYearWeek(ScheduledAt)",
    partitionColumn: "ScheduledAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "evaluationRun.foldProjection.ts:114 sets scheduledAt only in handleEvaluationScheduled; handleEvaluationStarted and handleEvaluationCompleted spread ...state without touching it, so it is written once and never advances. The writer at evaluation-run.clickhouse.repository.ts:603 is `new Date(data.scheduledAt ?? data.createdAt)`, and that fallback is the one way this could move — a row committed before the Scheduled event is folded would store createdAt and be replaced later. Frozen on the evidence that only the Scheduled handler sets it.",
    sortKey: ["TenantId", "EvaluationId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Details", "Error", "ErrorDetails"],
  },

  experiment_runs: {
    partitionExpression: "toYearWeek(StartedAt)",
    partitionColumn: "StartedAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "experimentRunState.foldProjection.ts:121-126 carries an explicit comment that StartedAt is first-write-wins, and line 183 implements it as `state.StartedAt ?? event.occurredAt`. Written at experimentRunState.clickhouse.repository.ts:140.",
    sortKey: ["TenantId", "RunId", "ExperimentId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  experiment_run_items: {
    partitionExpression: "toYearWeek(OccurredAt)",
    partitionColumn: "OccurredAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "experimentRunResultStorage.mapProjection.ts:85-123 derives ProjectionId deterministically from (runId, index, targetId, resultType[, evaluatorId]) and stamps OccurredAt from the event, so a redelivery of the same event re-derives the identical key AND the identical OccurredAt. Two different values cannot land under one key.",
    sortKey: ["TenantId", "RunId", "ProjectionId"],
    versionColumn: "OccurredAt",
    tenantColumns: ["TenantId"],
    heavyColumns: [
      "DatasetEntry",
      "Predicted",
      "EvaluationDetails",
      "EvaluationInputs",
    ],
  },

  simulation_runs: {
    partitionExpression: "toYearWeek(StartedAt)",
    partitionColumn: "StartedAt",
    partitionColumnStability: "movable",
    stabilityRationale:
      "Most handlers are first-write-wins (`state.StartedAt ?? event.occurredAt`, simulationRunState.foldProjection.ts:490/585/660) but handleSimulationRunStarted overwrites unconditionally at line 475, and the comments at 489/516-521 document that a MessageSnapshot can arrive and be persisted BEFORE RunStarted. So the later RunStarted write replaces a value already committed for the same (TenantId, ScenarioRunId), and the row moves.",
    sortKey: ["TenantId", "ScenarioRunId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Reasoning", "MetCriteria", "UnmetCriteria", "Error"],
  },

  suite_runs: {
    partitionExpression: "toYearWeek(StartedAt)",
    partitionColumn: "StartedAt",
    partitionColumnStability: "unverified",
    stabilityRationale:
      "UNVERIFIED, and probably unanswerable as written: no code anywhere under src/server or ee inserts into this table. It is referenced only by TTL/retention config (ttlReconciler.ts:114, retentionPolicy.schema.ts:274), and suite-run data is now served by aggregating simulation_runs on BatchRunId (scenario-events.router.ts, fetchSuiteRunData). The table looks retired; establish that before writing a read against it at all.",
    sortKey: ["TenantId", "ScenarioSetId", "BatchRunId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: [],
  },

  dspy_steps: {
    partitionExpression: "toYearWeek(CreatedAt)",
    partitionColumn: "CreatedAt",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "dspy-step.clickhouse.repository.ts:154,195 upserts read-then-preserve: upsertStep reads the existing row and keeps its createdAt when present, falling back to the incoming value only on first insert.",
    sortKey: ["TenantId", "ExperimentId", "RunId", "StepIndex"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["OptimizerParameters", "Predictors", "Examples", "LlmCalls"],
  },

  langy_messages: {
    partitionExpression: "toYYYYMM(CreatedAt)",
    partitionColumn: "CreatedAt",
    partitionColumnStability: "unverified",
    stabilityRationale:
      "UNVERIFIED, and probably unanswerable as written: no .ts file in the monorepo references langy_messages at all. Langy's message store is Postgres (langy-message-projection.prisma.repository.ts; pipelineRegistry.ts:170 calls it the Postgres per-message operational projection), and unlike its sibling langy_analytics_events this table appears in neither ttlReconciler.ts nor retentionPolicy.schema.ts. It looks legacy.",
    sortKey: ["TenantId", "ConversationId", "MessageId"],
    versionColumn: "UpdatedAt",
    tenantColumns: ["TenantId"],
    heavyColumns: ["Parts"],
  },

  stored_objects: {
    partitionExpression: "toYYYYMM(created_at)",
    partitionColumn: "created_at",
    partitionColumnStability: "frozen",
    stabilityRationale:
      "stored-objects.service.ts:219,228 is the single call site and sets created_at once, when the row is first built. `id` is generated fresh per upload and is half the sort key, so there is no rewrite path for an existing key at all. Written at stored-objects.repository.ts:56-71.",
    sortKey: ["project_id", "id"],
    versionColumn: "inserted_at",
    // The one table scoped by project_id rather than TenantId (00023).
    tenantColumns: ["project_id"],
    heavyColumns: [],
  },
} as const satisfies Record<string, TableShape>;

/** Every catalogued table name. */
export type CatalogueTable = keyof typeof SCHEMA_CATALOGUE;

/** Table names, for iteration by the runtime gate and the drift test. */
export const CATALOGUE_TABLES = Object.keys(
  SCHEMA_CATALOGUE,
) as CatalogueTable[];

/** True when `table` is one the catalogue describes. */
export function isCatalogueTable(table: string): table is CatalogueTable {
  return Object.hasOwn(SCHEMA_CATALOGUE, table);
}

/** The column a WHERE predicate must compare to prune `table`'s partitions. */
export function partitionColumnOf(table: CatalogueTable): string {
  return SCHEMA_CATALOGUE[table].partitionColumn;
}

/** The columns any one of which scopes a read of `table` to a tenant. */
export function tenantColumnsOf(table: CatalogueTable): readonly string[] {
  return SCHEMA_CATALOGUE[table].tenantColumns;
}

/** The column `argMax(…, <version>)` must dedup `table` on, if it has one. */
export function versionColumnOf(table: CatalogueTable): string | null {
  return SCHEMA_CATALOGUE[table].versionColumn;
}

/**
 * A read of `table` that may not range-filter its partition column inside a
 * dedup subquery. True for anything not established as frozen — `"unverified"`
 * reads as unsafe, because assuming otherwise is the failure this field exists
 * to prevent.
 */
export function partitionColumnMayMove(table: CatalogueTable): boolean {
  return SCHEMA_CATALOGUE[table].partitionColumnStability !== "frozen";
}

/**
 * Deliberate exceptions to a convention rule, matched against the query text.
 *
 * Registered here rather than written as a comment at the call site, because a
 * comment survives exactly until someone tidies up. Matching on the query's own
 * text rather than on the table alone keeps the exception narrow: if the query
 * changes, the exception stops applying and the violation starts counting
 * again, which is the ratchet we want. Exempting a whole (table, rule) pair
 * would blind the gate to every other read of that table.
 */
export interface ConventionExemption {
  readonly table: CatalogueTable;
  readonly rule: ConventionRule;
  /** Distinctive text of the query this excuses. */
  readonly matches: RegExp;
  /** Where the query lives, for a reader chasing the exemption back. */
  readonly site: string;
  /** Why the violation is sound here. */
  readonly reason: string;
}

/**
 * The exceptions we know to be deliberate.
 *
 * This list should shrink, not grow. Anything added here is a read that looks
 * wrong and is not, and it has to say why in enough detail that the next person
 * can check the claim rather than trust it.
 */
export const CONVENTION_EXEMPTIONS: readonly ConventionExemption[] = [
  {
    table: "stored_objects",
    rule: "tenant_predicate",
    matches: /SELECT\s+project_id\s+FROM\s+stored_objects\s+WHERE\s+id\s*=/i,
    site: "src/server/stored-objects/stored-objects-cross-tenant-lookup.ts",
    reason:
      "This read exists to DISCOVER which project owns a stored object, across every configured ClickHouse instance, so it cannot scope to the project it is trying to find. The caller re-scopes to that project before reading anything else about the row, which is the whole contract of resolveStoredObjectOwner.",
  },
];
