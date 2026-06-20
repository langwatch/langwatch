import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import { SpanCostService } from "./span-cost.service";

const service = new SpanCostService();

/**
 * A 1000-input-token span priced at a custom 0.001/token rate, so its cost is
 * a deterministic 1.0 regardless of the model registry.
 */
function costedSpan(overrides?: Partial<NormalizedSpan>): NormalizedSpan {
  return {
    traceId: "t1",
    spanId: "s1",
    parentSpanId: null,
    name: "llm",
    startTimeUnixMs: 0,
    endTimeUnixMs: 1000,
    spanAttributes: {
      "gen_ai.usage.input_tokens": 1000,
      "gen_ai.usage.output_tokens": 0,
      "langwatch.model.inputCostPerToken": 0.001,
    },
    resourceAttributes: {},
    events: [],
    links: [],
    ...overrides,
  } as unknown as NormalizedSpan;
}

function emptyState(): TraceSummaryData {
  return {
    totalCost: null,
    nonBilledCost: null,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    tokensEstimated: false,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
  } as unknown as TraceSummaryData;
}

describe("SpanCostService — bundled (non-billable) cost classification", () => {
  describe("isSpanCostNonBillable", () => {
    describe("given only a resource-level marker", () => {
      it("treats the resource marker as the span's default", () => {
        expect(
          service.isSpanCostNonBillable(
            costedSpan({
              resourceAttributes: { "langwatch.cost.non_billable": "true" },
            }),
          ),
        ).toBe(true);
      });

      it("treats a span with no marker anywhere as billed", () => {
        expect(service.isSpanCostNonBillable(costedSpan())).toBe(false);
      });
    });

    describe("given both a span-level and resource-level marker", () => {
      it("lets the span-level marker override the resource default", () => {
        // Resource says bundled, the span says billed — span wins.
        expect(
          service.isSpanCostNonBillable(
            costedSpan({
              resourceAttributes: { "langwatch.cost.non_billable": "true" },
              spanAttributes: {
                "gen_ai.usage.input_tokens": 1000,
                "gen_ai.usage.output_tokens": 0,
                "langwatch.model.inputCostPerToken": 0.001,
                "langwatch.cost.non_billable": "false",
              },
            }),
          ),
        ).toBe(false);
      });
    });
  });

  describe("accumulateTokens", () => {
    describe("when the span is billed per token", () => {
      it("keeps nonBilledCost null and totalCost at the full amount", () => {
        const result = service.accumulateTokens({
          state: emptyState(),
          span: costedSpan(),
          totalDurationMs: 1000,
        });
        expect(result.totalCost).toBe(1);
        expect(result.nonBilledCost).toBeNull();
      });
    });

    describe("when the span is bundled (resource marker set)", () => {
      /** @scenario "The bundled cost split is preserved when the non-billable marker is hidden" */
      it("routes the whole span cost into nonBilledCost", () => {
        const result = service.accumulateTokens({
          state: emptyState(),
          span: costedSpan({
            resourceAttributes: { "langwatch.cost.non_billable": "true" },
          }),
          totalDurationMs: 1000,
        });
        expect(result.totalCost).toBe(1);
        expect(result.nonBilledCost).toBe(1);
      });
    });

    describe("when a trace mixes billed and bundled spans", () => {
      it("only the bundled span contributes to nonBilledCost", () => {
        const afterBilled = service.accumulateTokens({
          state: emptyState(),
          span: costedSpan(),
          totalDurationMs: 1000,
        });
        const afterBundled = service.accumulateTokens({
          state: {
            ...emptyState(),
            totalCost: afterBilled.totalCost,
            nonBilledCost: afterBilled.nonBilledCost,
          } as TraceSummaryData,
          span: costedSpan({
            spanId: "s2",
            resourceAttributes: { "langwatch.cost.non_billable": "true" },
          }),
          totalDurationMs: 1000,
        });
        expect(afterBundled.totalCost).toBe(2);
        expect(afterBundled.nonBilledCost).toBe(1);
      });
    });
  });
});

// The trace-level cache rollup reads the canonical dotted cache keys. After
// canonicalisation maps the Go SDK's flat gen_ai.usage.cached_input_tokens onto
// gen_ai.usage.cache_read.input_tokens, the per-span cache-read count reaches
// this rollup and is summed across the trace.
//
// Spec: specs/ai-gateway/cache-token-telemetry.feature
describe("SpanCostService — cache token rollup", () => {
  describe("given a span carrying the canonical dotted cache keys", () => {
    it("surfaces the cache-read and cache-creation token counts", () => {
      const result = service.extractCacheTokens(
        costedSpan({
          spanAttributes: {
            "gen_ai.usage.input_tokens": 510,
            "gen_ai.usage.cache_read.input_tokens": 37127,
            "gen_ai.usage.cache_creation.input_tokens": 14,
          },
        }),
      );

      expect(result.cacheReadTokens).toBe(37127);
      expect(result.cacheCreationTokens).toBe(14);
    });

    it("reports zero cache-read tokens when no cache keys are present", () => {
      const result = service.extractCacheTokens(costedSpan());

      expect(result.cacheReadTokens).toBe(0);
      expect(result.cacheCreationTokens).toBe(0);
    });
  });
});
