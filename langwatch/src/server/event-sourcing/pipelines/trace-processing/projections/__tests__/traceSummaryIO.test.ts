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
          if (direction === "output") return { raw: "child output", text: "child output", source: "gen_ai" };
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
          if (direction === "output") return { raw: "root output", text: "root output", source: "gen_ai" };
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
          if (direction === "output") return { raw: "root output", text: "root output", source: "gen_ai" };
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
          if (direction === "output") return { raw: "child output", text: "child output", source: "gen_ai" };
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
        source: "langwatch",
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
        source: "langwatch",
      });

      const state = applySpanToSummary(createInitState(), guardrailSpan);
      expect(state.computedOutput).toBeNull();
      expect(state.computedInput).toBeNull();
      expect(extractSpy).not.toHaveBeenCalled();
    });
  });

  describe("when non-root spans compete for output", () => {
    it("last-finishing non-root span wins among same source type", () => {
      // First non-root span ending at 1500
      const span1 = createTestSpan({
        id: "span-1",
        spanId: "span-1",
        parentSpanId: "root",
        endTimeUnixMs: 1500,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "first output", text: "first output", source: "gen_ai" };
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
          if (direction === "output") return { raw: "second output", text: "second output", source: "gen_ai" };
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
          if (direction === "output") return { raw: "third output", text: "third output", source: "gen_ai" };
          return null;
        },
      );

      state = applySpanToSummary(state, span3);
      expect(state.computedOutput).toBe("second output");
      expect(state.outputSpanEndTimeMs).toBe(2000);
    });
  });

  describe("when explicit (langwatch) source competes with inferred (gen_ai) source", () => {
    it("explicit source beats inferred source even with earlier endTime", () => {
      // First: inferred (gen_ai) output at endTime 2000
      const inferredSpan = createTestSpan({
        id: "inferred-1",
        spanId: "inferred-1",
        parentSpanId: "root",
        endTimeUnixMs: 2000,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "inferred output", text: "inferred output", source: "gen_ai" };
          return null;
        },
      );

      let state = applySpanToSummary(createInitState(), inferredSpan);
      expect(state.computedOutput).toBe("inferred output");

      // Second: explicit (langwatch) output at earlier endTime 1500
      const explicitSpan = createTestSpan({
        id: "explicit-1",
        spanId: "explicit-1",
        parentSpanId: "root",
        endTimeUnixMs: 1500,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "explicit output", text: "explicit output", source: "langwatch" };
          return null;
        },
      );

      state = applySpanToSummary(state, explicitSpan);
      expect(state.computedOutput).toBe("explicit output");
    });

    it("inferred source cannot override explicit source even with later endTime", () => {
      // First: explicit (langwatch) output at endTime 1500
      const explicitSpan = createTestSpan({
        id: "explicit-1",
        spanId: "explicit-1",
        parentSpanId: "root",
        endTimeUnixMs: 1500,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "explicit output", text: "explicit output", source: "langwatch" };
          return null;
        },
      );

      let state = applySpanToSummary(createInitState(), explicitSpan);
      expect(state.computedOutput).toBe("explicit output");

      // Second: inferred (gen_ai) output at later endTime 3000
      const inferredSpan = createTestSpan({
        id: "inferred-1",
        spanId: "inferred-1",
        parentSpanId: "root",
        endTimeUnixMs: 3000,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "inferred output", text: "inferred output", source: "gen_ai" };
          return null;
        },
      );

      state = applySpanToSummary(state, inferredSpan);
      expect(state.computedOutput).toBe("explicit output");
    });

    it("later explicit source overrides earlier explicit source", () => {
      // First explicit output at endTime 1000
      const span1 = createTestSpan({
        id: "step-1",
        spanId: "step-1",
        parentSpanId: "root",
        endTimeUnixMs: 1000,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "step 1 output", text: "step 1 output", source: "langwatch" };
          return null;
        },
      );

      let state = applySpanToSummary(createInitState(), span1);
      expect(state.computedOutput).toBe("step 1 output");

      // Second explicit output at later endTime 2000
      const span2 = createTestSpan({
        id: "step-2",
        spanId: "step-2",
        parentSpanId: "root",
        endTimeUnixMs: 2000,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "step 2 output", text: "step 2 output", source: "langwatch" };
          return null;
        },
      );

      state = applySpanToSummary(state, span2);
      expect(state.computedOutput).toBe("step 2 output");
    });
  });

  describe("when Mastra-like trace has model_step and chat spans", () => {
    it("keeps model_step explicit output over later-finishing chat inferred output", () => {
      // model_step 1: explicit output, endTime 34000
      const modelStep1 = createTestSpan({
        id: "model-step-1",
        spanId: "model-step-1",
        parentSpanId: "root",
        endTimeUnixMs: 34000,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "step 1 thinking", text: "step 1 thinking", source: "langwatch" };
          return null;
        },
      );

      let state = applySpanToSummary(createInitState(), modelStep1);

      // model_step 2: explicit output, endTime 35994
      const modelStep2 = createTestSpan({
        id: "model-step-2",
        spanId: "model-step-2",
        parentSpanId: "root",
        endTimeUnixMs: 35994,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "final answer", text: "final answer", source: "langwatch" };
          return null;
        },
      );

      state = applySpanToSummary(state, modelStep2);
      expect(state.computedOutput).toBe("final answer");

      // chat span: inferred output, endTime 36020 (later than model_step 2!)
      const chatSpan = createTestSpan({
        id: "chat-1",
        spanId: "chat-1",
        parentSpanId: "root",
        endTimeUnixMs: 36020,
      });

      extractSpy.mockImplementation(
        (_span: NormalizedSpan, direction: "input" | "output") => {
          if (direction === "output") return { raw: "concatenated text", text: "concatenated text", source: "gen_ai" };
          return null;
        },
      );

      state = applySpanToSummary(state, chatSpan);
      // chat's inferred output should NOT override model_step 2's explicit output
      expect(state.computedOutput).toBe("final answer");
    });
  });
});
