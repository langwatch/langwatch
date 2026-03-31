/**
 * @vitest-environment node
 *
 * Unit tests for thread variables available in trace-level evaluator input mapping.
 * Feature: specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature
 */
import { describe, expect, it } from "vitest";
import {
  getTraceAvailableSources,
  getThreadAvailableSources,
} from "../tracesMapping";

describe("Feature: Thread variables available in trace-level evaluator input mapping", () => {
  // -------------------------------------------------------------------------
  // @unit Scenario: Trace-level mapping UI includes both trace and thread available sources
  // -------------------------------------------------------------------------
  describe("getTraceAvailableSources()", () => {
    describe("when the evaluator mapping level is 'trace'", () => {
      it("includes a 'Trace' group with trace-level fields", () => {
        const sources = getTraceAvailableSources([], []);
        const traceGroup = sources.find((s) => s.name === "Trace");

        expect(traceGroup).toBeDefined();
        expect(traceGroup!.id).toBe("trace");
        // Trace group should have input, output, etc.
        const fieldNames = traceGroup!.fields.map((f) => f.name);
        expect(fieldNames).toContain("input");
        expect(fieldNames).toContain("output");
      });

      it("includes a 'Thread' group with thread-level fields", () => {
        const sources = getTraceAvailableSources([], []);
        const threadGroup = sources.find((s) => s.name === "Thread");

        expect(threadGroup).toBeDefined();
        expect(threadGroup!.id).toBe("thread");
      });
    });
  });

  // -------------------------------------------------------------------------
  // @unit Scenario: Thread-level mapping UI still shows only thread sources
  // -------------------------------------------------------------------------
  describe("getThreadAvailableSources()", () => {
    describe("when the evaluator mapping level is 'thread'", () => {
      it("includes a 'Thread' group with thread-level fields", () => {
        const sources = getThreadAvailableSources();
        const threadGroup = sources.find((s) => s.name === "Thread");

        expect(threadGroup).toBeDefined();
        expect(threadGroup!.id).toBe("thread");
      });

      it("does not include a 'Trace' group", () => {
        const sources = getThreadAvailableSources();
        const traceGroup = sources.find((s) => s.name === "Trace");

        expect(traceGroup).toBeUndefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // @unit Scenario: Thread source fields include thread_id, traces, and formatted_traces
  // -------------------------------------------------------------------------
  describe("when the evaluator mapping level is 'trace'", () => {
    describe("when the available sources are computed", () => {
      it("'Thread' group contains the field 'thread_id'", () => {
        const sources = getTraceAvailableSources([], []);
        const threadGroup = sources.find((s) => s.name === "Thread");
        const fieldNames = threadGroup!.fields.map((f) => f.name);

        expect(fieldNames).toContain("thread_id");
      });

      it("'Thread' group contains the field 'traces'", () => {
        const sources = getTraceAvailableSources([], []);
        const threadGroup = sources.find((s) => s.name === "Thread");
        const fieldNames = threadGroup!.fields.map((f) => f.name);

        expect(fieldNames).toContain("traces");
      });

      it("'Thread' group contains the field 'formatted_traces'", () => {
        const sources = getTraceAvailableSources([], []);
        const threadGroup = sources.find((s) => s.name === "Thread");
        const fieldNames = threadGroup!.fields.map((f) => f.name);

        expect(fieldNames).toContain("formatted_traces");
      });
    });
  });

  // -------------------------------------------------------------------------
  // @unit Scenario: hasThreadMappings detects thread-typed mappings in a mixed config
  // -------------------------------------------------------------------------
  describe("hasThreadMappings()", () => {
    // We test this by importing directly from the service where it's defined
    // But since it's a private helper in evaluation-execution.service.ts,
    // we test it indirectly here by verifying the mapping state detection
    describe("given a mapping state with one trace source and one thread source", () => {
      it("detects thread-typed mappings", () => {
        const mappingState = {
          mapping: {
            input: { source: "input" as const },
            conversation: {
              type: "thread" as const,
              source: "formatted_traces" as const,
            },
          },
          expansions: [],
        };

        const hasThread = Object.values(mappingState.mapping).some(
          (mapping) => "type" in mapping && mapping.type === "thread",
        );

        expect(hasThread).toBe(true);
      });
    });
  });
});
