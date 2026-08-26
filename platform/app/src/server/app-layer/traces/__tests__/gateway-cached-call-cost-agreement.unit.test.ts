import { TraceCanonicalisationService } from "@langwatch/trace-server";
/**
 * One cached gateway call, priced by the two surfaces that hold money.
 *
 * A customer reads the same request's cost in two places that are computed
 * from two different records. The Usage page folds `trace_summaries`, built
 * from the span the gateway emits. Budgets and the ledger read
 * `gateway_spend`, built from the spend record the gateway emits. Both feed
 * the same rate table, so they can only disagree when the two records state
 * different quantities for the same request.
 *
 * They did. The span took the cached tokens out of its input count and the
 * spend record shipped the provider's cache-inclusive total, so the rating
 * seam priced every cached token twice: once at the input rate and once at
 * the cache-read rate. On gpt-5 that is $0.0067095 against $0.0007895 for one
 * real call, and the Usage page and the budget reported different money for
 * the same virtual key.
 *
 * The fixture is that call, measured through a locally lifted gateway:
 * 4,814 prompt tokens of which 4,736 came from the provider's cache.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_SPEND_USAGE } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import {
  NANO_USD_PER_USD,
  rateSpendNanoUsd,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import {
  createInitState,
  createSpanReceivedEvent,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import { TraceSummaryFoldProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";

/**
 * The usage a provider reports, before either record is built. `promptTokens`
 * is the provider's own total and holds the cached tokens, which is the whole
 * reason a split is needed.
 */
interface ProviderUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** One real gpt-5 turn whose prompt was almost entirely a cache hit. */
const CACHED_CALL: ProviderUsage = {
  model: "openai/gpt-5",
  promptTokens: 4814,
  completionTokens: 10,
  cacheReadTokens: 4736,
  cacheCreationTokens: 0,
};

/** The same turn with nothing cached: the overwhelming majority of traffic. */
const UNCACHED_CALL: ProviderUsage = {
  model: "openai/gpt-5",
  promptTokens: 4814,
  completionTokens: 10,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

/**
 * What the gateway charges at the plain input rate: the prompt total with the
 * cached tokens taken out. This mirrors `domain.Usage.BillableInputTokens` in
 * the Go gateway, which is the single place both records get their input count
 * from. Both surfaces below are fed from here, so a surface that starts
 * reading a different quantity fails this file rather than a customer's
 * invoice.
 */
function billableInputTokens(usage: ProviderUsage): number {
  const fresh = usage.promptTokens - usage.cacheReadTokens - usage.cacheCreationTokens;
  return fresh < 0 ? usage.promptTokens : fresh;
}

/** The Usage page's number: the trace summary fold over the emitted span. */
function traceCostUsd(usage: ProviderUsage, inputTokens: number): number {
  const event = createSpanReceivedEvent({
    name: "gen_ai.chat",
    attributes: {
      "langwatch.span.type": "llm",
      "gen_ai.request.model": usage.model,
      "gen_ai.usage.input_tokens": inputTokens,
      "gen_ai.usage.output_tokens": usage.completionTokens,
      "gen_ai.usage.cache_read.input_tokens": usage.cacheReadTokens,
      "gen_ai.usage.cache_creation.input_tokens": usage.cacheCreationTokens,
    },
  });
  const summary = new TraceSummaryFoldProjection({
    traceCanonicalisation: TraceCanonicalisationService.create(),
    store: { store: async () => {}, get: async () => null },
  }).handleTraceSpanReceived(event, createInitState());
  return summary.totalCost ?? 0;
}

/** The budget's and the ledger's number: the rated spend record. */
function billedCostUsd(usage: ProviderUsage, inputTokens: number): number {
  const { costNanoUsd } = rateSpendNanoUsd({
    model: usage.model,
    usage: {
      ...EMPTY_SPEND_USAGE,
      input_tokens: inputTokens,
      output_tokens: usage.completionTokens,
      cache_read_input_tokens: usage.cacheReadTokens,
      cache_creation_input_tokens: usage.cacheCreationTokens,
    },
  });
  return costNanoUsd / NANO_USD_PER_USD;
}

/**
 * The trace fold rounds its running total to millionths of a dollar while the
 * spend record keeps whole nano-USD, so the two land within half a millionth
 * of each other rather than bit for bit. A gap wider than that is the two
 * surfaces pricing different quantities, which is the defect this file pins
 * shut: the same call was $0.0067095 on one surface and $0.0007895 on the
 * other, five thousand times this tolerance.
 */
const ONE_MILLIONTH_OF_A_DOLLAR = 1e-6;

/** How far apart the two surfaces priced the same call. */
function surfaceGap(trace: number, billed: number): number {
  return Math.abs(trace - billed);
}

describe("the cost of one cached gateway call", () => {
  describe("given a prompt the provider served from its cache", () => {
    /** @scenario "The trace and the bill price a cached request at the same number" */
    it("prices it the same on the trace surface and the spend surface", () => {
      const input = billableInputTokens(CACHED_CALL);
      expect(input).toBe(78);

      expect(
        surfaceGap(traceCostUsd(CACHED_CALL, input), billedCostUsd(CACHED_CALL, input)),
      ).toBeLessThan(ONE_MILLIONTH_OF_A_DOLLAR);
      // 78 * 1.25e-6 + 10 * 1e-5 + 4736 * 1.25e-7
      expect(billedCostUsd(CACHED_CALL, input)).toBeCloseTo(0.0007895, 9);
    });

    /** @scenario "The trace and the bill price a cached request at the same number" */
    it("charges far more when the billed input count still holds the cached tokens", () => {
      const trace = traceCostUsd(CACHED_CALL, billableInputTokens(CACHED_CALL));
      const cacheInclusive = billedCostUsd(CACHED_CALL, CACHED_CALL.promptTokens);

      // The cached tokens priced at the input rate on top of their own:
      // 4736 * 1.25e-6 above what the trace says the call cost.
      expect(cacheInclusive - trace).toBeCloseTo(0.00592, 6);
      expect(cacheInclusive / trace).toBeGreaterThan(8);
    });
  });

  describe("given a prompt with nothing cached", () => {
    /** @scenario "The trace and the bill price a cached request at the same number" */
    it("charges exactly what it charged before the split existed", () => {
      const input = billableInputTokens(UNCACHED_CALL);
      expect(input).toBe(UNCACHED_CALL.promptTokens);

      expect(
        surfaceGap(
          traceCostUsd(UNCACHED_CALL, input),
          billedCostUsd(UNCACHED_CALL, input),
        ),
      ).toBeLessThan(ONE_MILLIONTH_OF_A_DOLLAR);
      // 4814 * 1.25e-6 + 10 * 1e-5
      expect(billedCostUsd(UNCACHED_CALL, input)).toBeCloseTo(0.0061175, 9);
    });
  });
});
