import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { NormalizedSpan } from "../../schemas/spans";
import { NormalizedSpanKind, NormalizedStatusCode } from "../../schemas/spans";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  applySpanToSummary,
  createTraceSummaryFoldProjection,
  type TraceSummaryData,
} from "../traceSummary.foldProjection";

const traceSummaryProjection = createTraceSummaryFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

function createInitState(): TraceSummaryData {
  return traceSummaryProjection.init();
}

function createTestSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "tenant-1",
    parentSpanId: "parent-1",
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.UNSET,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
    ...overrides,
  };
}

describe("applySpanToSummary I/O logic", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when root span output overrides child span output", () => {
    it("keeps root span output", () => {
      // First apply child span with output
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        endTimeUnixMs: 1500,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "child output", text: "child output" };
          return null;
        },
      );

      let state = applySpanToSummary(createInitState(), childSpan);
      expect(state.computedOutput).toBe("child output");
      expect(state.outputFromRootSpan).toBe(false);

      // Now apply root span with output — should override
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        endTimeUnixMs: 2000,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "root output", text: "root output" };
          return null;
        },
      );

      state = applySpanToSummary(state, rootSpan);
      expect(state.computedOutput).toBe("root output");
      expect(state.outputFromRootSpan).toBe(true);
    });
  });

  describe("when child span arrives after root span", () => {
    it("does not override root span output", () => {
      // First apply root span
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        endTimeUnixMs: 2000,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "root output", text: "root output" };
          return null;
        },
      );

      let state = applySpanToSummary(createInitState(), rootSpan);
      expect(state.computedOutput).toBe("root output");
      expect(state.outputFromRootSpan).toBe(true);

      // Now apply child span — should NOT override root
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        endTimeUnixMs: 2500,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "child output", text: "child output" };
          return null;
        },
      );

      state = applySpanToSummary(state, childSpan);
      expect(state.computedOutput).toBe("root output");
      expect(state.outputFromRootSpan).toBe(true);
    });
  });

  describe("when evaluation/guardrail spans have I/O", () => {
    it("excludes evaluation spans from I/O extraction", () => {
      const evalSpan = createTestSpan({
        id: "eval-1",
        spanId: "eval-1",
        spanAttributes: { "langwatch.span.type": "evaluation" },
      });

      extractSpy.mockReturnValue({
        raw: "eval output",
        text: "eval output",
      });

      const state = applySpanToSummary(createInitState(), evalSpan);
      expect(state.computedOutput).toBeNull();
      expect(state.computedInput).toBeNull();
      expect(extractSpy).not.toHaveBeenCalled();
    });

    it("excludes guardrail spans from I/O extraction", () => {
      const guardrailSpan = createTestSpan({
        id: "guard-1",
        spanId: "guard-1",
        spanAttributes: { "langwatch.span.type": "guardrail" },
      });

      extractSpy.mockReturnValue({
        raw: "guardrail output",
        text: "guardrail output",
      });

      const state = applySpanToSummary(createInitState(), guardrailSpan);
      expect(state.computedOutput).toBeNull();
      expect(state.computedInput).toBeNull();
      expect(extractSpy).not.toHaveBeenCalled();
    });
  });

  describe("when non-root spans compete for output", () => {
    it("last-finishing non-root span wins", () => {
      // First non-root span ending at 1500
      const span1 = createTestSpan({
        id: "span-1",
        spanId: "span-1",
        parentSpanId: "root",
        endTimeUnixMs: 1500,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "first output", text: "first output" };
          return null;
        },
      );

      let state = applySpanToSummary(createInitState(), span1);
      expect(state.computedOutput).toBe("first output");
      expect(state.outputSpanEndTimeMs).toBe(1500);

      // Second non-root span ending later at 2000
      const span2 = createTestSpan({
        id: "span-2",
        spanId: "span-2",
        parentSpanId: "root",
        endTimeUnixMs: 2000,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "second output", text: "second output" };
          return null;
        },
      );

      state = applySpanToSummary(state, span2);
      expect(state.computedOutput).toBe("second output");
      expect(state.outputSpanEndTimeMs).toBe(2000);

      // Third non-root span ending earlier at 1200 — should NOT override
      const span3 = createTestSpan({
        id: "span-3",
        spanId: "span-3",
        parentSpanId: "root",
        endTimeUnixMs: 1200,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "third output", text: "third output" };
          return null;
        },
      );

      state = applySpanToSummary(state, span3);
      expect(state.computedOutput).toBe("second output");
      expect(state.outputSpanEndTimeMs).toBe(2000);
    });
  });
});
