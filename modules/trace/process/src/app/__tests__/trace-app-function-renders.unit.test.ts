/**
 * What the LangWatchQL message and trace app functions answer with, as the
 * trace peer renders them: both sides as JSON, one side as a bare array, the
 * whole trace, and a span read out of the trace-and-span pair.
 * @see specs/lwql/app-functions.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { Span, Trace, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceApp, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";

function createTraceApp(): TraceApi {
  return TraceApp.create(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
}

const llmSpan: Span = {
  trace_id: "t1",
  span_id: "s1",
  type: "llm",
  timestamps: { started_at: 1, finished_at: 2 },
  input: { type: "chat_messages", value: [{ role: "user", content: "hi" }] },
  output: { type: "text", value: "hello" },
};

const trace: Trace = {
  trace_id: "t1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  input: { value: "ask" },
  output: { value: "answer" },
  spans: [llmSpan],
};

describe("given a trace-keyed app function", () => {
  describe("when llm_messages is rendered", () => {
    it("answers JSON holding both sides", async () => {
      const rendered = await createTraceApp().renderTraceMessages({ trace, side: "both" });

      expect(JSON.parse(String(rendered))).toMatchObject({
        input: expect.any(Array),
        output: expect.any(Array),
      });
    });
  });

  describe("when llm_input_messages is rendered", () => {
    it("answers a bare array", async () => {
      const rendered = await createTraceApp().renderTraceMessages({ trace, side: "input" });

      expect(Array.isArray(JSON.parse(String(rendered)))).toBe(true);
    });
  });

  describe("when trace_json is rendered", () => {
    it("answers the whole trace", async () => {
      const rendered = await createTraceApp().renderTraceJson({ trace });

      expect(JSON.parse(rendered)).toHaveProperty("trace_id", "t1");
    });
  });
});

describe("given a trace-and-span keyed app function", () => {
  describe("when the span is one the trace holds", () => {
    it("answers that span's messages", async () => {
      const rendered = await createTraceApp().renderSpanMessages({ trace, spanId: "s1" });

      expect(rendered.isSpanPresent).toBe(true);
      expect(rendered.json).toContain("hello");
    });
  });

  describe("when the span is one the trace does not hold", () => {
    /** @scenario "A span the trace does not hold is an unresolved key" */
    it("says the span is absent rather than answering empty messages", async () => {
      const rendered = await createTraceApp().renderSpanMessages({ trace, spanId: "absent" });

      expect(rendered).toEqual({ isSpanPresent: false, json: null });
    });
  });
});
