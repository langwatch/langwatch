// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { useRetainedTraceHeader } from "../useRetainedTraceHeader";

function makeTrace(overrides: Partial<TraceHeader> = {}): TraceHeader {
  return {
    traceId: "trace-a",
    timestamp: 1_700_000_000_000,
    name: "root",
    serviceName: "svc",
    origin: null,
    conversationId: null,
    userId: null,
    durationMs: 120,
    spanCount: 3,
    status: "ok",
    error: null,
    input: null,
    output: null,
    models: [],
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    inputTokens: null,
    outputTokens: null,
    tokensEstimated: false,
    ttft: null,
    traceName: "",
    rootSpanType: null,
    scenarioRunId: null,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    attributes: {},
    ...overrides,
  } as TraceHeader;
}

describe("useRetainedTraceHeader", () => {
  describe("given a trace whose attributes flap from populated to empty", () => {
    describe("when a later payload for the same traceId drops attributes", () => {
      it("keeps the previously seen non-empty attributes", () => {
        const full = makeTrace({
          attributes: { "metadata.tenant": "org-acme" },
          conversationId: "conv-1",
          userId: "user-1",
        });
        const { result, rerender } = renderHook(
          ({ trace }) => useRetainedTraceHeader(trace),
          { initialProps: { trace: full } },
        );
        expect(result.current.attributes["metadata.tenant"]).toBe("org-acme");

        // Seed-shaped payload: same trace, empty attributes, null ids.
        rerender({ trace: makeTrace() });

        expect(result.current.attributes["metadata.tenant"]).toBe("org-acme");
        expect(result.current.conversationId).toBe("conv-1");
        expect(result.current.userId).toBe("user-1");
      });

      it("still adopts fresher non-empty attributes", () => {
        const { result, rerender } = renderHook(
          ({ trace }) => useRetainedTraceHeader(trace),
          {
            initialProps: {
              trace: makeTrace({ attributes: { "metadata.a": "1" } }),
            },
          },
        );
        rerender({
          trace: makeTrace({ attributes: { "metadata.a": "2" } }),
        });
        expect(result.current.attributes["metadata.a"]).toBe("2");
      });
    });

    describe("when the traceId changes", () => {
      it("resets retention so chips from the old trace never leak", () => {
        const { result, rerender } = renderHook(
          ({ trace }) => useRetainedTraceHeader(trace),
          {
            initialProps: {
              trace: makeTrace({
                attributes: { "metadata.tenant": "org-acme" },
                conversationId: "conv-1",
              }),
            },
          },
        );
        rerender({ trace: makeTrace({ traceId: "trace-b" }) });
        expect(result.current.attributes).toEqual({});
        expect(result.current.conversationId).toBeNull();
      });
    });
  });

  describe("given a payload with nothing to retain", () => {
    it("returns the input object identity unchanged", () => {
      const trace = makeTrace({ attributes: { k: "v" } });
      const { result } = renderHook(() => useRetainedTraceHeader(trace));
      expect(result.current).toBe(trace);
    });
  });
});
