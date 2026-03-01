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

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

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

      let state = applySpanToSummary(createInitState(), span1);
      state = applySpanToSummary(state, span2);

      // mergedAttributes uses { ...spanAttributes, ...state.attributes }
      // so state.attributes (first-wins) takes priority
      expect(state.attributes["gen_ai.agent.name"]).toBe("first-agent");
    });
  });
});
