/**
 * Thread sources inside a TRACE-level evaluation. A trace-level evaluator fires once per
 * incoming trace, and may still map one of its inputs at the thread.
 */
import type { MappingState } from "@langwatch/dataset-contract";
import type { Span, Trace } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { EvaluationSpanDigest } from "../../app/evaluation.members.ts";
import {
  hasThreadMappings,
  resolveThreadMappingsIntoData,
} from "../../rules/evaluation-thread-mapping-service.rules.ts";

const spanDigest: EvaluationSpanDigest = {
  format: vi.fn(async (spans: Span[]) => spans.map((span) => span.name ?? "span").join(" ")),
};

function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    trace_id: "trace-1",
    project_id: "project-1",
    timestamps: { started_at: 0, inserted_at: 0, updated_at: 0 },
    input: { value: "Hello" },
    output: { value: "Hi" },
    metadata: { thread_id: "abc" },
    spans: [
      {
        span_id: "span-1",
        trace_id: "trace-1",
        type: "span",
        name: "root",
        timestamps: { started_at: 0, finished_at: 0 },
      },
    ],
    ...overrides,
  };
}

/** Every trace the thread holds, as the fetch callback answers with them. */
function threadTraces(): Trace[] {
  return [
    trace({ trace_id: "trace-1", input: { value: "Hello" }, output: { value: "Hi" } }),
    trace({ trace_id: "trace-2", input: { value: "And?" }, output: { value: "So." } }),
  ];
}

const mixedMappings: MappingState = {
  mapping: {
    input: { source: "input" },
    conversation: { type: "thread", source: "formatted_traces" },
  },
  expansions: [],
};

describe("thread mappings inside a trace-level evaluation", () => {
  describe("given a mapping state that mixes a trace source with a thread source", () => {
    /** @scenario "hasThreadMappings detects thread-typed mappings in a mixed config" */
    it("reports that the state carries a thread mapping", () => {
      expect(hasThreadMappings(mixedMappings)).toBe(true);
    });

    it("reports none for a state whose sources are all trace-level", () => {
      expect(
        hasThreadMappings({
          mapping: { input: { source: "input" } },
          expansions: [],
        }),
      ).toBe(false);
    });
  });

  describe("given an input mapped to the thread's traces", () => {
    /** @scenario "Trace-level evaluation resolves a thread source mapping" */
    it("fetches the thread's traces and fills the field with them", async () => {
      const getThreadTraces = vi.fn(async () => threadTraces());
      const data: Record<string, unknown> = {};

      await resolveThreadMappingsIntoData({
        data,
        trace: trace(),
        mappings: {
          mapping: {
            history: { type: "thread", source: "traces", selectedFields: ["input", "output"] },
          },
          expansions: [],
        },
        getThreadTraces,
        spanDigest,
      });

      expect(getThreadTraces).toHaveBeenCalledWith("abc");
      expect(JSON.stringify(data.history)).toContain("And?");
    });
  });

  describe("given one input mapped at the trace and another at the thread", () => {
    /**
     * The worker runs this same resolver: its evaluation-processing composition
     * builds `EvaluationExecutionService`, whose trace-level branch calls here.
     * @scenario "Trace-level evaluation resolves mixed trace and thread source mappings"
     * @scenario "Background worker resolves mixed trace and thread mappings"
     */
    it("leaves the trace field alone and fills the thread field with the digest", async () => {
      const data: Record<string, unknown> = { input: "Hello" };

      await resolveThreadMappingsIntoData({
        data,
        trace: trace(),
        mappings: mixedMappings,
        getThreadTraces: async () => threadTraces(),
        spanDigest,
      });

      expect(data.input).toBe("Hello");
      expect(data.conversation).toBe("root\n\n---\n\nroot");
    });
  });

  describe("given the trace carries no thread_id", () => {
    /** @scenario "Trace-level evaluation with thread source but trace has no thread_id" */
    it("empties the thread field, keeps the trace field, and does not fail", async () => {
      const getThreadTraces = vi.fn(async () => threadTraces());
      const data: Record<string, unknown> = { input: "Hello" };

      await resolveThreadMappingsIntoData({
        data,
        trace: trace({ metadata: {} }),
        mappings: mixedMappings,
        getThreadTraces,
        spanDigest,
      });

      expect(data.conversation).toBe("");
      expect(data.input).toBe("Hello");
      expect(getThreadTraces).not.toHaveBeenCalled();
    });
  });
});
