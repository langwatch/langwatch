import type { TraceFullRecord } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  applyTraceFullRecordProtections,
  internalTraceFullReadProtections,
} from "../src/repositories/clickhouse/trace-full-protection.mapper";

const trace = (): TraceFullRecord => ({
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  input: { type: "text", value: "secret prompt" },
  output: { type: "text", value: "secret answer" },
  metrics: { total_cost: 1, total_time_ms: 2 },
  spans: [
    {
      span_id: "span-1",
      trace_id: "trace-1",
      type: "llm",
      timestamps: { started_at: 1, finished_at: 2 },
      input: { type: "text", value: "secret prompt" },
      output: { type: "text", value: "secret answer" },
      metrics: { cost: 1, prompt_tokens: 2 },
      params: { request: "secret prompt" },
    },
  ],
  events: [
    {
      event_id: "event-1",
      event_type: "feedback",
      project_id: "project-1",
      trace_id: "trace-1",
      metrics: {},
      event_details: { comment: "secret prompt" },
      timestamps: { started_at: 1, inserted_at: 1, updated_at: 2 },
    },
  ],
});

describe("Trace full-record protections", () => {
  it("keeps the explicit internal policy all-visible", () => {
    expect(applyTraceFullRecordProtections(trace(), internalTraceFullReadProtections)).toEqual(
      trace(),
    );
  });

  it("keeps shape while redacting hidden capture and costs for a future actor-aware adapter", () => {
    const protectedTrace = applyTraceFullRecordProtections(trace(), {
      canSeeCapturedInput: false,
      canSeeCapturedOutput: false,
      canSeeCosts: false,
    });

    expect(protectedTrace.input).toBeUndefined();
    expect(protectedTrace.output).toBeUndefined();
    expect(protectedTrace.metrics).toEqual({ total_time_ms: 2 });
    expect(protectedTrace.spans[0]).toMatchObject({
      input: { type: "text", value: "[REDACTED]" },
      output: { type: "text", value: "[REDACTED]" },
      metrics: { prompt_tokens: 2 },
      params: { request: "[REDACTED]" },
    });
    expect(protectedTrace.events?.[0]?.event_details).toEqual({ comment: "[REDACTED]" });
  });
});
