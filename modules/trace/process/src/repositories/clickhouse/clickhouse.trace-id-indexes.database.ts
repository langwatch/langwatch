import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/** Trace's id indexes as goose 00110 creates them (dev/docs/plans/id-index-2026-10-10.md §1). */
export const TRACE_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({ source: "trace_summaries", key: ["TraceId"], time: "OccurredAt" }),
  defineIdIndex({ source: "stored_spans", key: ["TraceId"], time: "StartTime" }),
  defineIdIndex({ source: "trace_analytics", key: ["TraceId"], time: "OccurredAt" }),
];
