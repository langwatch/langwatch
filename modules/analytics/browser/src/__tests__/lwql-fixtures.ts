/**
 * Fixtures shared by the workbench suites: one schema response and one
 * result shape, so assertions compare against the literal the surface was
 * given, not a second hand-written list that could drift into agreement.
 */

import type { LangWatchQLQueryResult, LangWatchQLSchema } from "@langwatch/analytics-contract";

/**
 * A response with two datasets, a gated column, units, join keys and example
 * SQL — everything the browser and the completion model are supposed to read.
 */
export const SCHEMA_RESPONSE: LangWatchQLSchema = {
  database: "analytics",
  functions: [],
  appFunctions: [],
  views: [
    {
      name: "analytics.traces_daily",
      description: "One row per trace, rolled up by day.",
      grain: "one row per trace per day",
      joinKeys: ["trace_id", "project_id"],
      timeColumn: "occurred_on",
      freshness: "up to 15 minutes behind ingestion",
      columns: [
        {
          name: "trace_id",
          type: "String",
          description: "Identifier of the trace.",
          unit: null,
          gates: [],
          available: true,
        },
        {
          name: "latency_ms",
          type: "Float64",
          description: "End to end latency of the trace.",
          unit: "ms",
          gates: [],
          available: true,
        },
        {
          name: "total_cost",
          type: "Decimal(18, 8)",
          description: "Money spent on the trace.",
          unit: "USD",
          gates: ["costs"],
          available: false,
        },
      ],
      exampleSql:
        "SELECT trace_id, latency_ms\nFROM analytics.traces_daily\nWHERE occurred_on >= subtractDays(now(), 7)\nLIMIT 100",
    },
    {
      name: "analytics.evaluations_daily",
      description: "One row per evaluation result, rolled up by day.",
      grain: "one row per evaluation per day",
      joinKeys: ["trace_id"],
      timeColumn: "occurred_on",
      freshness: "up to 1 hour behind ingestion",
      columns: [
        {
          name: "evaluator_id",
          type: "String",
          description: "Identifier of the evaluator that produced the score.",
          unit: null,
          gates: [],
          available: true,
        },
        {
          name: "score",
          type: "Nullable(Float64)",
          description: "Score the evaluator returned.",
          unit: null,
          gates: [],
          available: true,
        },
      ],
      exampleSql:
        "SELECT evaluator_id, score\nFROM analytics.evaluations_daily\nWHERE occurred_on >= subtractDays(now(), 7)\nLIMIT 100",
    },
  ],
};

/** Every dataset name the response carries. */
export const SCHEMA_DATASET_NAMES = SCHEMA_RESPONSE.views.map((dataset) => dataset.name);

/** Every column name the response carries, gated ones included. */
export const SCHEMA_COLUMN_NAMES = SCHEMA_RESPONSE.views.flatMap((dataset) =>
  dataset.columns.map((column) => column.name),
);

/** Every column name the response marks available to this member. */
export const SCHEMA_AVAILABLE_COLUMN_NAMES = SCHEMA_RESPONSE.views.flatMap((dataset) =>
  dataset.columns.filter((column) => column.available).map((column) => column.name),
);

export function lwqlResult(
  overrides: Partial<LangWatchQLQueryResult> = {},
): LangWatchQLQueryResult {
  return {
    columns: [{ name: "trace_id", type: "String" }],
    rows: [{ trace_id: "trace-1" }],
    statistics: {
      elapsedMs: 42,
      rowsRead: 1_000,
      bytesRead: 65_536,
      rowsReturned: 1,
    },
    diagnostics: [],
    followsTimeWindow: true,
    followsGranularity: false,
    ...overrides,
  };
}

/**
 * The envelope a handled error arrives in over tRPC, which is what
 * `readHandledError` parses.
 */
export function handledErrorEnvelope({
  code,
  httpStatus = 400,
  fault = "customer",
  meta = {},
}: {
  code: string;
  httpStatus?: number;
  fault?: string;
  meta?: Record<string, unknown>;
}): unknown {
  return { data: { error: { code, httpStatus, fault, meta } } };
}

// The Vega-Lite corpus moved with the policy it validates, into
// `@langwatch/analytics-contract`. It is re-exported here rather than imported
// twice because the workbench suites reach for LangWatchQL fixtures and chart
// fixtures in the same breath, and there is exactly one corpus either way.
export * from "@langwatch/analytics-contract/testing";
