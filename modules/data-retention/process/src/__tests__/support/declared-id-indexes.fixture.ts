import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/**
 * The id indexes the installed modules declare on the process's client, as data retention reads
 * them at run time: copied-retention indexes over governed sources, the event log's, and two it
 * leaves alone (a source it does not govern, and one that keeps no retention of its own).
 */
export const DECLARED_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({ source: "trace_summaries", key: ["TraceId"], time: "OccurredAt" }),
  defineIdIndex({ source: "stored_spans", key: ["TraceId"], time: "StartTime" }),
  defineIdIndex({ source: "trace_analytics", key: ["TraceId"], time: "OccurredAt" }),
  defineIdIndex({
    source: "evaluation_runs",
    key: ["EvaluationId"],
    time: "ScheduledAt",
    retentionAnchor: "UpdatedAt",
  }),
  defineIdIndex({ source: "evaluation_analytics", key: ["EvaluationId"], time: "OccurredAt" }),
  defineIdIndex({ source: "experiment_runs", key: ["RunId"], time: "StartedAt" }),
  defineIdIndex({ source: "dspy_steps", key: ["ExperimentId", "RunId"], time: "CreatedAt" }),
  defineIdIndex({ source: "simulation_runs", key: ["ScenarioRunId"], time: "StartedAt" }),
  defineIdIndex({ source: "suite_runs", key: ["BatchRunId"], time: "StartedAt" }),
  defineIdIndex({
    source: "event_log",
    key: ["AggregateType", "AggregateId"],
    time: "EventOccurredAt",
    filter: "EventOccurredAt > 0",
    timeFormat: "epoch_ms",
  }),
  defineIdIndex({ source: "coding_agent_sessions", key: ["SessionId"], time: "StartedAt" }),
  defineIdIndex({
    source: "gateway_spend",
    key: ["GatewayRequestId"],
    time: "OccurredAt",
    retention: "none",
  }),
];

/**
 * A second index on `experiment_runs`, by another key:
 * `experiment_runs_by_experiment_id_index`.
 */
export const EXPERIMENT_RUNS_BY_EXPERIMENT: IdIndexDeclaration = defineIdIndex({
  source: "experiment_runs",
  key: ["ExperimentId"],
  time: "StartedAt",
  by: true,
});
