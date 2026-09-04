/**
 * Thread sources inside a TRACE-level evaluation.
 *
 * A trace-level evaluator fires once per incoming trace, and may still map one
 * of its inputs at the thread. This module is the single resolver both the
 * online execution path and the background evaluations worker run — the worker
 * composes the same `EvaluationExecutionService`, which calls straight into
 * here — so the mixed-mapping rules are pinned once.
 *
 * See specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature.
 */
import type { MappingState, Trace } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import type { EvaluationSpanDigestPort } from "../../ports/evaluation-execution.port";
import {
  hasThreadMappings,
  resolveThreadMappingsIntoData,
} from "../evaluation-thread-mapping.service";

const spanDigest = {
  format: vi.fn(async (spans: { name?: string }[]) =>
    spans.map((span) => span.name ?? "span").join(" "),
  ),
} as unknown as EvaluationSpanDigestPort;

function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    trace_id: "trace-1",
    project_id: "project-1",
    timestamps: { started_at: 0, inserted_at: 0, updated_at: 0 },
    input: { value: "Hello" },
    output: { value: "Hi" },
    metadata: { thread_id: "abc" },
    spans: [{ name: "root" }],
    ...overrides,
  } as unknown as Trace;
}

/** Every trace the thread holds, as the fetch callback answers with them. */
function threadTraces(): Trace[] {
  return [
    trace({ trace_id: "trace-1", input: { value: "Hello" }, output: { value: "Hi" } } as never),
    trace({ trace_id: "trace-2", input: { value: "And?" }, output: { value: "So." } } as never),
  ];
}

const mixedMappings: MappingState = {
  mapping: {
    input: { source: "input" },
    conversation: { type: "thread", source: "formatted_traces" },
  },
  expansions: [],
} as unknown as MappingState;

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
        } as unknown as MappingState),
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
        } as unknown as MappingState,
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
        trace: trace({ metadata: {} } as never),
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
