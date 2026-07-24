/**
 * @vitest-environment node
 *
 * Unit tests for thread variables available in trace-level evaluator input mapping.
 * Feature: specs/features/experiments-v3/thread-variables-in-trace-evaluator.feature
 */
import { describe, expect, it } from "vitest";
import {
  getTraceAvailableSources,
  getThreadAvailableSources,
} from "../tracesMapping";
import { hasThreadMappings } from "~/server/evaluations/threadMappingResolver";

describe("Feature: Thread variables available in trace-level evaluator input mapping", () => {
  describe("getTraceAvailableSources()", () => {
    describe("when the evaluator mapping level is 'trace'", () => {
      /** @scenario 'Trace-level mapping UI includes both trace and thread available sources' */
      it("includes a 'Current Trace' group with trace-level fields", () => {
        const sources = getTraceAvailableSources([], []);
        const traceGroup = sources.find((s) => s.name === "Current Trace");

        expect(traceGroup).toBeDefined();
        expect(traceGroup!.id).toBe("trace");
        // Trace group should have input, output, etc.
        const fieldNames = traceGroup!.fields.map((f) => f.name);
        expect(fieldNames).toContain("input");
        expect(fieldNames).toContain("output");
      });

      it("includes a 'Current Thread' group with thread-level fields", () => {
        const sources = getTraceAvailableSources([], []);
        const threadGroup = sources.find((s) => s.name === "Current Thread");

        expect(threadGroup).toBeDefined();
        expect(threadGroup!.id).toBe("thread");
      });
    });
  });

  describe("getThreadAvailableSources()", () => {
    describe("when the evaluator mapping level is 'thread'", () => {
      /** @scenario 'Thread-level mapping UI still shows only thread sources' */
      it("includes a 'Current Thread' group with thread-level fields", () => {
        const sources = getThreadAvailableSources();
        const threadGroup = sources.find((s) => s.name === "Current Thread");

        expect(threadGroup).toBeDefined();
        expect(threadGroup!.id).toBe("thread");
      });

      it("does not include a 'Current Trace' group", () => {
        const sources = getThreadAvailableSources();
        const traceGroup = sources.find((s) => s.name === "Current Trace");

        expect(traceGroup).toBeUndefined();
      });
    });
  });

  describe("when the evaluator mapping level is 'trace'", () => {
    describe("when the available sources are computed", () => {
      /** @scenario 'Thread source fields include thread_id, traces, and formatted_traces' */
      it("'Current Thread' group contains the field 'thread_id'", () => {
        const sources = getTraceAvailableSources([], []);
        const threadGroup = sources.find((s) => s.name === "Current Thread");
        const fieldNames = threadGroup!.fields.map((f) => f.name);

        expect(fieldNames).toContain("thread_id");
      });

      it("'Current Thread' group contains the field 'traces'", () => {
        const sources = getTraceAvailableSources([], []);
        const threadGroup = sources.find((s) => s.name === "Current Thread");
        const fieldNames = threadGroup!.fields.map((f) => f.name);

        expect(fieldNames).toContain("traces");
      });

      it("'Current Thread' group contains the field 'formatted_traces'", () => {
        const sources = getTraceAvailableSources([], []);
        const threadGroup = sources.find((s) => s.name === "Current Thread");
        const fieldNames = threadGroup!.fields.map((f) => f.name);

        expect(fieldNames).toContain("formatted_traces");
      });
    });
  });

  describe("hasThreadMappings()", () => {
    describe("given a mapping state with one trace source and one thread source", () => {
      /** @scenario 'hasThreadMappings detects thread-typed mappings in a mixed config' */
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

        expect(hasThreadMappings(mappingState)).toBe(true);
      });
    });

    describe("given a mapping state with only trace sources", () => {
      it("returns false", () => {
        const mappingState = {
          mapping: {
            input: { source: "input" as const },
            output: { source: "output" as const },
          },
          expansions: [],
        };

        expect(hasThreadMappings(mappingState)).toBe(false);
      });
    });

    describe("given null", () => {
      it("returns false", () => {
        expect(hasThreadMappings(null)).toBe(false);
      });
    });
  });
});
