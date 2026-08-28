import { describe, expect, it } from "vitest";
import {
  traceFullReadInputSchema,
  traceFullRecordSchema,
  traceFullThreadReadInputSchema,
} from "../src/trace-full-read.contract";

describe("Trace full-read contract", () => {
  it("preserves the rich capture fields for internal readers", () => {
    const trace = traceFullRecordSchema.parse({
      trace_id: "trace-1",
      project_id: "project-1",
      metadata: { thread_id: "thread-1", customer: { id: "customer-1" } },
      timestamps: { started_at: 10, inserted_at: 11, updated_at: 12 },
      input: { type: "chat_messages", value: [{ role: "user", content: "hello" }] },
      output: { type: "text", value: "world" },
      error: null,
      privacy: { droppedCategories: ["input"] },
      metrics: { cost: 0.02 },
      spans: [
        {
          span_id: "span-1",
          trace_id: "trace-1",
          parent_id: null,
          type: "llm",
          name: "answer",
          timestamps: { started_at: 10, finished_at: 12 },
          input: { value: "hello" },
          output: { value: "world" },
          generated: { tool_calls: [] },
          params: { langwatch: { causality_depth: 2 } },
          contexts: [{ content: "context" }],
          metrics: { prompt_tokens: 3 },
        },
      ],
      events: [
        {
          event_id: "event-1",
          event_type: "feedback",
          project_id: "project-1",
          trace_id: "trace-1",
          metrics: { score: 1 },
          event_details: { source: "user" },
          timestamps: { started_at: 10, inserted_at: 11, updated_at: 12 },
        },
      ],
    });

    expect(trace.metadata.thread_id).toBe("thread-1");
    expect(trace.spans[0]?.params).toEqual({ langwatch: { causality_depth: 2 } });
    expect(trace.events?.[0]?.event_type).toBe("feedback");
  });

  it("accepts only tenant-scoped identities and an optional storage-anchor hint", () => {
    expect(traceFullReadInputSchema.parse({ tenantId: "tenant", traceId: "trace" })).toEqual({
      tenantId: "tenant",
      traceId: "trace",
    });
    expect(
      traceFullThreadReadInputSchema.parse({ tenantId: "tenant", threadId: "thread" }),
    ).toEqual({
      tenantId: "tenant",
      threadId: "thread",
    });
    expect(() =>
      traceFullReadInputSchema.parse({
        tenantId: "tenant",
        traceId: "trace",
        full: true,
      }),
    ).toThrow();
  });
});
