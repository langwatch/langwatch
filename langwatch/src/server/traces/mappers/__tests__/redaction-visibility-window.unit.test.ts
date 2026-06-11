import { describe, expect, it } from "vitest";

import type { Protections } from "~/server/elasticsearch/protections";
import type { Trace } from "~/server/tracer/types";

import { TEASER_MAX_CHARS } from "~/server/app-layer/traces/visibility-window.service";
import { applyTraceProtections } from "../redaction";

const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_ACCESS: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

const makeTrace = (startedDaysAgo: number): Trace =>
  ({
    trace_id: "trace-1",
    project_id: "project-1",
    metadata: { labels: ["checkout"] },
    timestamps: {
      started_at: Date.now() - startedDaysAgo * DAY_MS,
      inserted_at: Date.now() - startedDaysAgo * DAY_MS,
      updated_at: Date.now() - startedDaysAgo * DAY_MS,
    },
    input: { value: "i".repeat(5000) },
    output: { value: "o".repeat(5000) },
    metrics: { total_cost: 1.5, prompt_tokens: 10 },
    spans: [
      {
        span_id: "span-1",
        trace_id: "trace-1",
        type: "llm",
        input: { type: "text", value: "p".repeat(5000) },
        output: { type: "text", value: "q".repeat(5000) },
        timestamps: {
          started_at: Date.now() - startedDaysAgo * DAY_MS,
          finished_at: Date.now() - startedDaysAgo * DAY_MS + 1000,
        },
      },
    ],
  }) as Trace;

describe("given a plan with a visibility window", () => {
  describe("when the trace is older than the cutoff", () => {
    const protections: Protections = {
      ...FULL_ACCESS,
      visibilityCutoffMs: Date.now() - 14 * DAY_MS,
    };

    it("teases trace content and stamps the redacted flag", () => {
      const result = applyTraceProtections(makeTrace(15), protections);
      expect(result.input?.value).toHaveLength(TEASER_MAX_CHARS);
      expect(result.output?.value).toHaveLength(TEASER_MAX_CHARS);
      expect(result.redacted_by_visibility_window).toBe(true);
    });

    it("teases span content through the same pass", () => {
      const result = applyTraceProtections(makeTrace(15), protections);
      const spanInput = result.spans?.[0]?.input as { value: string };
      expect(spanInput.value).toHaveLength(TEASER_MAX_CHARS);
    });

    it("keeps metadata, metrics, and timestamps intact", () => {
      const trace = makeTrace(15);
      const result = applyTraceProtections(trace, protections);
      expect(result.metadata).toEqual(trace.metadata);
      expect(result.metrics?.total_cost).toBe(1.5);
      expect(result.timestamps).toEqual(trace.timestamps);
    });
  });

  describe("when the trace is within the window", () => {
    it("returns full content and no redacted flag", () => {
      const result = applyTraceProtections(makeTrace(5), {
        ...FULL_ACCESS,
        visibilityCutoffMs: Date.now() - 14 * DAY_MS,
      });
      expect(result.input?.value).toHaveLength(5000);
      expect(result.redacted_by_visibility_window).toBeUndefined();
    });
  });

  describe("when the plan has no visibility window", () => {
    it("returns content identical to a protections pass without the field", () => {
      const trace = makeTrace(40);
      const withNull = applyTraceProtections(trace, {
        ...FULL_ACCESS,
        visibilityCutoffMs: null,
      });
      const without = applyTraceProtections(trace, FULL_ACCESS);
      expect(withNull).toEqual(without);
      expect(withNull.input?.value).toHaveLength(5000);
      expect(withNull.redacted_by_visibility_window).toBeUndefined();
    });
  });
});
