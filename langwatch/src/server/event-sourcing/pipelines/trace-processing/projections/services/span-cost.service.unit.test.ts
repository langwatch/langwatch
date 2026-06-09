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
