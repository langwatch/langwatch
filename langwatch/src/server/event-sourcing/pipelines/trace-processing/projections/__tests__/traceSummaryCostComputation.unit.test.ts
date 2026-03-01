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

describe("applySpanToSummary cost computation", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
    extractSpy.mockReturnValue(null);
  });

  afterEach(() => {
    extractSpy.mockRestore();
  });

  describe("when span has custom cost rates and tokens", () => {
    it("computes cost from custom rates", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
          "langwatch.model.inputCostPerToken": 0.000005,
          "langwatch.model.outputCostPerToken": 0.000015,
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      // 100 * 0.000005 + 50 * 0.000015 = 0.0005 + 0.00075 = 0.00125
      expect(result.totalCost).toBeCloseTo(0.00125, 6);
    });
  });

  describe("when span has model and tokens but no custom rates", () => {
    it("uses static registry for cost computation", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 1000,
          "gen_ai.usage.output_tokens": 500,
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      // gpt-4o is in the static registry, so cost should be computed
      // The exact value depends on the JSON file, but it should be > 0
      expect(result.totalCost).not.toBeNull();
      expect(result.totalCost).toBeGreaterThan(0);
    });
  });

  describe("when model is not in static registry", () => {
    it("returns cost as 0 (null in state)", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "totally-unknown-model-xyz-12345",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when no tokens are present", () => {
    it("returns cost as null", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-4o",
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when no model is present", () => {
    it("falls back to SDK cost if available", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
          "langwatch.span.cost": 0.005,
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalCost).toBeCloseTo(0.005, 6);
    });
  });

  describe("when no model and no SDK cost", () => {
    it("returns cost as null", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when span is a guardrail with cost in output", () => {
    it("extracts guardrail cost from langwatch.output object", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": {
            passed: true,
            cost: { amount: 0.0042, currency: "USD" },
          },
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalCost).toBeCloseTo(0.0042, 6);
    });

    it("ignores guardrail cost when currency is not USD", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": {
            passed: true,
            cost: { amount: 0.0042, currency: "EUR" },
          },
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalCost).toBeNull();
    });

    it("ignores guardrail cost when output is a string", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": "not-json",
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when custom rates have only inputCostPerToken", () => {
    it("computes cost using only input rate", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
          "langwatch.model.inputCostPerToken": 0.00001,
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      // 100 * 0.00001 + 50 * 0 = 0.001
      expect(result.totalCost).toBeCloseTo(0.001, 6);
    });
  });
});

describe("applySpanToSummary guardrail blocking detection", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
    extractSpy.mockReturnValue(null);
  });

  afterEach(() => {
    extractSpy.mockRestore();
  });

  describe("when guardrail span has passed=false", () => {
    it("sets blockedByGuardrail to true", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": { passed: false },
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.blockedByGuardrail).toBe(true);
    });
  });

  describe("when guardrail span has passed=true", () => {
    it("keeps blockedByGuardrail as false", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": { passed: true },
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.blockedByGuardrail).toBe(false);
    });
  });

  describe("when non-guardrail span is processed", () => {
    it("does not set blockedByGuardrail", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.blockedByGuardrail).toBe(false);
    });
  });
});
