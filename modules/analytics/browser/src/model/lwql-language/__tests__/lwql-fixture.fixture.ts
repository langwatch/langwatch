import type { LangWatchQLSchema } from "@langwatch/analytics-contract";

export const SCHEMA: LangWatchQLSchema = {
  database: "lwql",
  functions: ["count", "quantile_ms", "conversation_bounded"],
  views: [
    {
      name: "traces",
      description: "One row per trace.",
      grain: "trace",
      joinKeys: ["TraceId"],
      timeColumn: "OccurredAt",
      freshness: "seconds",
      exampleSql: "SELECT 1",
      columns: [
        {
          name: "TraceId",
          type: "String",
          description: "The trace's id.",
          unit: null,
          gates: [],
          available: true,
        },
        {
          name: "TotalCost",
          type: "Float64",
          description: "Cost of the trace.",
          unit: "USD",
          gates: ["cost:view"],
          available: false,
        },
        {
          name: "DurationMs",
          type: "UInt64",
          description: "How long the trace took.",
          unit: "ms",
          gates: [],
          available: true,
        },
      ],
    },
    {
      name: "spans",
      description: "One row per span.",
      grain: "span",
      joinKeys: ["TraceId"],
      timeColumn: null,
      freshness: "seconds",
      exampleSql: "SELECT 1",
      columns: [
        {
          name: "SpanId",
          type: "String",
          description: "The span's id.",
          unit: null,
          gates: [],
          available: true,
        },
      ],
    },
  ],
  appFunctions: [
    {
      name: "conversation_bounded",
      signature: "conversation_bounded(thread_key, max_tokens)",
      description: "The thread's conversation, bounded.",
      returns: "String",
      encoding: "text",
      keyKind: "thread",
      kind: "extraction",
      cap: 10,
      gates: [],
      available: true,
      exampleSql: "SELECT 1",
    },
  ],
};
