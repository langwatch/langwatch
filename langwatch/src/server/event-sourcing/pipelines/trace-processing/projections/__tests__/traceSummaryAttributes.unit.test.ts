import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { NormalizedSpan } from "../../schemas/spans";
import { NormalizedSpanKind, NormalizedStatusCode } from "../../schemas/spans";
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

function createTestSpan(
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan {
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

describe("applySpanToSummary attribute forwarding", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
    extractSpy.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when span has gen_ai.agent.name", () => {
    it("forwards to trace summary attributes", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.agent.name": "weather-agent",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["gen_ai.agent.name"]).toBe("weather-agent");
    });
  });

  describe("when span has gen_ai.agent.id", () => {
    it("forwards to trace summary attributes", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.agent.id": "agent-123",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["gen_ai.agent.id"]).toBe("agent-123");
    });
  });

  describe("when span has gen_ai.provider.name", () => {
    it("forwards to trace summary attributes", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.provider.name": "openai",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["gen_ai.provider.name"]).toBe("openai");
    });
  });

  describe("when multiple spans provide agent info", () => {
    it("keeps first-wins semantics", () => {
      const span1 = createTestSpan({
        spanAttributes: {
          "gen_ai.agent.name": "first-agent",
        },
      });

      const span2 = createTestSpan({
        id: "span-2",
        spanId: "span-2",
        spanAttributes: {
          "gen_ai.agent.name": "second-agent",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: span1 });
      state = applySpanToSummary({ state, span: span2 });

      // mergedAttributes uses { ...spanAttributes, ...state.attributes }
      // so state.attributes (first-wins) takes priority
      expect(state.attributes["gen_ai.agent.name"]).toBe("first-agent");
    });
  });

  describe("when span has langwatch.reserved.evaluations", () => {
    it("forwards evaluations to trace summary attributes", () => {
      const evaluations = [
        { name: "toxicity", score: 0.1, passed: true },
      ];
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(
        JSON.parse(state.attributes["langwatch.reserved.evaluations"]!),
      ).toEqual(evaluations);
    });
  });

  describe("when multiple spans have evaluations", () => {
    it("merges evaluations from different spans", () => {
      const evals1 = [{ name: "toxicity", score: 0.1 }];
      const evals2 = [{ name: "relevance", score: 0.9 }];

      const span1 = createTestSpan({
        spanAttributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evals1),
        },
      });
      const span2 = createTestSpan({
        id: "span-2",
        spanId: "span-2",
        spanAttributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evals2),
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: span1 });
      state = applySpanToSummary({ state, span: span2 });

      const merged = JSON.parse(
        state.attributes["langwatch.reserved.evaluations"]!,
      );
      expect(merged).toHaveLength(2);
      expect(merged).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "toxicity" }),
          expect.objectContaining({ name: "relevance" }),
        ]),
      );
    });

    it("deduplicates evaluations by evaluation_id", () => {
      const evals1 = [
        { evaluation_id: "eval-1", name: "toxicity", score: 0.1 },
      ];
      const evals2 = [
        { evaluation_id: "eval-1", name: "toxicity", score: 0.2 },
        { evaluation_id: "eval-2", name: "relevance", score: 0.9 },
      ];

      const span1 = createTestSpan({
        spanAttributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evals1),
        },
      });
      const span2 = createTestSpan({
        id: "span-2",
        spanId: "span-2",
        spanAttributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evals2),
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: span1 });
      state = applySpanToSummary({ state, span: span2 });

      const merged = JSON.parse(
        state.attributes["langwatch.reserved.evaluations"]!,
      );
      expect(merged).toHaveLength(2);
      expect(merged.map((e: { evaluation_id?: string; name: string }) => e.evaluation_id ?? e.name)).toEqual(
        expect.arrayContaining(["eval-1", "eval-2"]),
      );
    });
  });
});
