/**
 * @vitest-environment node
 * ADR-177 block D: a trace route reaches a trace read only through `TraceApi`, whose reads take
 * the proof by name. A route that mints none does not compile, so typecheck is the build gate.
 * Each call sits behind `@ts-expect-error`; the bodies are never run.
 */
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

declare const app: TraceApi;

describe("a trace route and the proof", () => {
  describe("when a route calls a trace read without the authorization parameter", () => {
    /** @scenario "A trace route without a proof fails the build" */
    it("fails to type-check", () => {
      const withoutTheProof = [
        // @ts-expect-error the span read needs the proof by name
        () => app.readSpans({ traceId: "trace" }),
        // @ts-expect-error the span summaries read needs the proof by name
        () => app.readSpanSummaries({ traceId: "trace" }),
        // @ts-expect-error the trace events read needs the proof by name
        () => app.readTraceEvents({ traceId: "trace" }),
        // @ts-expect-error the stored spans read needs the proof by name
        () => app.findNormalizedSpansByTraceId({ traceId: "trace" }),
      ];

      expect(withoutTheProof).toHaveLength(4);
    });

    it("refuses a project id handed over where the proof goes", () => {
      // @ts-expect-error a tenant id is not a proof
      const byTenant = () => app.readSpans({ authorization: "project-1", traceId: "trace" });

      expect(byTenant).toBeTypeOf("function");
    });
  });
});
