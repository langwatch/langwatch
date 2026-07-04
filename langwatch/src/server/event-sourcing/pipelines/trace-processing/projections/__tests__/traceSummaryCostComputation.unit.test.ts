import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

      expect(result.totalCost).toBeNull();
    });

    it("ignores guardrail cost when output is a string", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": "not-json",
        },
      });

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when token counts are strings", () => {
    it("coerces string tokens and computes cost from static registry", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": "100",
          "gen_ai.usage.output_tokens": "50",
        },
      });

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

      expect(result.totalPromptTokenCount).toBe(100);
      expect(result.totalCompletionTokenCount).toBe(50);
      expect(result.totalCost).not.toBeNull();
      expect(result.totalCost).toBeGreaterThan(0);
    });
  });

  describe("when custom rates have only inputCostPerToken", () => {
    it("prices the unset output rate from the registry instead of zeroing it", () => {
      // Derive the registry's output rate for the model from an output-only span.
      const registryOutputOnly = applySpanToSummary({
        state: createInitState(),
        span: createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 0,
            "gen_ai.usage.output_tokens": 50,
          },
        }),
      }).totalCost;
      expect(registryOutputOnly).toBeGreaterThan(0);

      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
          "langwatch.model.inputCostPerToken": 0.00001,
        },
      });

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

      // custom input rate + registry output rate — output is NOT free.
      expect(result.totalCost).toBeCloseTo(
        100 * 0.00001 + (registryOutputOnly ?? 0),
        5,
      );
      expect(result.totalCost).toBeGreaterThan(0.001);
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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

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

      const result = applySpanToSummary({
        state: createInitState(),
        span: span,
      });

      expect(result.blockedByGuardrail).toBe(false);
    });
  });
});

describe("applySpanToSummary token timing from OTel instrumentation events (@regression)", () => {
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

  describe("when span has ai.stream.firstChunk/ai.stream.finish events (Vercel AI SDK)", () => {
    it("computes timeToFirstToken from ai.stream.firstChunk", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 4000,
        durationMs: 3000,
        events: [
          { name: "ai.stream.firstChunk", timeUnixMs: 1250, attributes: {} },
          { name: "ai.stream.finish", timeUnixMs: 3800, attributes: {} },
        ],
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(250);
    });

    it("computes timeToLastToken from ai.stream.finish", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 4000,
        durationMs: 3000,
        events: [
          { name: "ai.stream.firstChunk", timeUnixMs: 1250, attributes: {} },
          { name: "ai.stream.finish", timeUnixMs: 3800, attributes: {} },
        ],
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToLastTokenMs).toBe(2800);
    });
  });

  describe("when span has First Token Stream Event (OpenInference)", () => {
    it("computes timeToFirstToken from First Token Stream Event", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 3000,
        durationMs: 2000,
        events: [
          {
            name: "First Token Stream Event",
            timeUnixMs: 1200,
            attributes: {},
          },
        ],
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(200);
    });
  });

  describe("when span has gen_ai.server.time_to_first_token attribute (Strands SDK)", () => {
    it("computes timeToFirstToken from the span attribute when no events exist", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 4000,
        durationMs: 3000,
        events: [],
        spanAttributes: {
          "gen_ai.server.time_to_first_token": 2046,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(2046);
    });

    it("coerces string attribute to number", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 4000,
        durationMs: 3000,
        events: [],
        spanAttributes: {
          "gen_ai.server.time_to_first_token": "3125",
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(3125);
    });

    it("prefers event-based TTFT over the span attribute", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 4000,
        durationMs: 3000,
        events: [{ name: "first_token", timeUnixMs: 1300, attributes: {} }],
        spanAttributes: {
          "gen_ai.server.time_to_first_token": 500,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(300);
    });
  });

  describe("when span has gen_ai.content.chunk events (already supported)", () => {
    it("computes timeToFirstToken as before", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 3000,
        durationMs: 2000,
        events: [
          { name: "gen_ai.content.chunk", timeUnixMs: 1100, attributes: {} },
          { name: "gen_ai.content.chunk", timeUnixMs: 2900, attributes: {} },
        ],
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(100);
      expect(result.timeToLastTokenMs).toBe(1900);
    });
  });

  describe("when span has llm.content.completion.chunk events (OpenLLMetry / traceloop)", () => {
    it("computes timeToFirstToken from the earliest chunk and timeToLastToken from the latest", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 3000,
        durationMs: 2000,
        events: [
          {
            name: "llm.content.completion.chunk",
            timeUnixMs: 1150,
            attributes: {},
          },
          {
            name: "llm.content.completion.chunk",
            timeUnixMs: 2700,
            attributes: {},
          },
        ],
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(150);
      expect(result.timeToLastTokenMs).toBe(1700);
    });
  });

  describe("when span has ai.response.msToFirstChunk attribute (Vercel AI SDK)", () => {
    it("computes timeToFirstToken from the duration attribute when no events exist", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 4000,
        durationMs: 3000,
        events: [],
        spanAttributes: {
          "ai.response.msToFirstChunk": 1716,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(1716);
    });

    it("prefers event-based TTFT over the duration attribute", () => {
      const span = createTestSpan({
        startTimeUnixMs: 1000,
        endTimeUnixMs: 4000,
        durationMs: 3000,
        events: [
          { name: "ai.stream.firstChunk", timeUnixMs: 1250, attributes: {} },
        ],
        spanAttributes: {
          "ai.response.msToFirstChunk": 1716,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.timeToFirstTokenMs).toBe(250);
    });
  });
});

describe("applySpanToSummary cache + reasoning token roll-up", () => {
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

  describe("when cache write lands on the first span and cache read on later spans", () => {
    it("sums cache read + cache write across the trace into reserved keys", () => {
      const first = createTestSpan({
        spanId: "span-a",
        spanAttributes: {
          "gen_ai.request.model": "claude-opus-4-8",
          "gen_ai.usage.cache_creation.input_tokens": 19701,
        },
      });
      const second = createTestSpan({
        spanId: "span-b",
        spanAttributes: {
          "gen_ai.request.model": "claude-opus-4-8",
          "gen_ai.usage.cache_read.input_tokens": 19701,
          "gen_ai.usage.cache_creation.input_tokens": 10852,
        },
      });

      const afterFirst = applySpanToSummary({
        state: createInitState(),
        span: first,
      });
      const result = applySpanToSummary({ state: afterFirst, span: second });

      // The last span carries no cache write, so reading the raw merged
      // attribute would drop it entirely — the sum is what keeps it visible.
      expect(result.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
        "19701",
      );
      expect(
        result.attributes["langwatch.reserved.cache_creation_tokens"],
      ).toBe("30553");
    });
  });

  describe("when no span reports reasoning tokens", () => {
    it("leaves the reserved reasoning key unset so the drawer hides the row", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "claude-opus-4-8",
          "gen_ai.usage.cache_read.input_tokens": 100,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(
        result.attributes["langwatch.reserved.reasoning_tokens"],
      ).toBeUndefined();
    });
  });

  describe("when a span reports reasoning tokens", () => {
    it("sums them onto the reserved reasoning key", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "o3",
          "gen_ai.usage.reasoning_tokens": 512,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span });

      expect(result.attributes["langwatch.reserved.reasoning_tokens"]).toBe(
        "512",
      );
    });
  });
});

describe("applySpanToSummary model ordering", () => {
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

  describe("when a utility model is used before the conversational one", () => {
    it("orders models most-recently-used first so models[0] is conversational", () => {
      const titleGen = createTestSpan({
        spanId: "span-a",
        spanAttributes: { "gen_ai.request.model": "claude-haiku-4-5" },
      });
      const conversation = createTestSpan({
        spanId: "span-b",
        spanAttributes: { "gen_ai.request.model": "claude-opus-4-8" },
      });

      const afterFirst = applySpanToSummary({
        state: createInitState(),
        span: titleGen,
      });
      const result = applySpanToSummary({
        state: afterFirst,
        span: conversation,
      });

      expect(result.models).toEqual(["claude-opus-4-8", "claude-haiku-4-5"]);
    });
  });
});
