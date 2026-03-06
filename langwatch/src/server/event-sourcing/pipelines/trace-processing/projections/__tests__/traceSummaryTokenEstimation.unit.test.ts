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

describe("applySpanToSummary token estimation integration", () => {
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

  // Token estimation happens in RecordSpanCommand (OTLP span level), which
  // pushes gen_ai.usage.input_tokens, gen_ai.usage.output_tokens, and
  // langwatch.tokens.estimated onto the raw span. After canonicalization,
  // these attributes become canonical keys that the fold projection reads.

  describe("when estimated token attributes are present (post-RecordSpanCommand estimation)", () => {
    it("reads estimated tokens and computes cost", () => {
      // After RecordSpanCommand runs token estimation and canonicalization
      // processes the span, the normalized span will have these attributes.
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "gpt-4o-mini",
          "gen_ai.usage.input_tokens": 25,
          "gen_ai.usage.output_tokens": 12,
          "langwatch.tokens.estimated": true,
          "gen_ai.input.messages": [
            { role: "user", content: "Hello, how are you?" },
          ],
          "gen_ai.output.messages": [
            { role: "assistant", content: "I'm doing well!" },
          ],
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalPromptTokenCount).toBe(25);
      expect(result.totalCompletionTokenCount).toBe(12);
      expect(result.tokensEstimated).toBe(true);
      // gpt-4o-mini is in the static registry, so cost should be computed
      expect(result.totalCost).not.toBeNull();
      expect(result.totalCost).toBeGreaterThan(0);
    });
  });

  describe("when SDK-provided token counts are present (not estimated)", () => {
    it("uses provided values and marks estimated as false", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "gpt-4o-mini",
          "gen_ai.usage.input_tokens": 42,
          "gen_ai.usage.output_tokens": 17,
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalPromptTokenCount).toBe(42);
      expect(result.totalCompletionTokenCount).toBe(17);
      expect(result.tokensEstimated).toBe(false);
    });
  });

  describe("when LLM span has model and input/output but NO token count attributes", () => {
    it("produces null token counts (estimation is RecordSpanCommand's responsibility)", () => {
      // This test documents the current behavior: if token estimation didn't
      // run (or was skipped), the fold projection does not estimate on its own.
      // Token estimation happens upstream in RecordSpanCommand.
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "gpt-4o-mini",
          "gen_ai.input.messages": [
            { role: "user", content: "Hello, how are you?" },
          ],
          "gen_ai.output.messages": [
            { role: "assistant", content: "I'm doing well!" },
          ],
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      // Without token attributes, the fold projection correctly reports null.
      // The fix ensures RecordSpanCommand pushes these attributes before
      // the span reaches this point.
      expect(result.totalPromptTokenCount).toBeNull();
      expect(result.totalCompletionTokenCount).toBeNull();
      expect(result.totalCost).toBeNull();
    });
  });

  describe("when non-LLM span has no token counts", () => {
    it("does not produce token counts", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "tool",
          "gen_ai.request.model": "gpt-4o-mini",
        },
      });

      const result = applySpanToSummary(createInitState(), span);

      expect(result.totalPromptTokenCount).toBeNull();
      expect(result.totalCompletionTokenCount).toBeNull();
    });
  });
});
