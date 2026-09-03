/**
 * One cached gateway call, priced by the two surfaces that hold money.
 *
 * A customer reads the same request's cost in two places computed from two
 * different records. The Usage page folds `trace_summaries`, built from the
 * span the gateway emits (trace-server). Budgets and the ledger read
 * `gateway_spend`, built from the spend record the gateway emits
 * (gateway-server). Both feed the same rate table, so they can only disagree
 * when the two records state different quantities for the same request.
 *
 * They did once: the span took the cached tokens out of its input count
 * while the spend record shipped the provider's cache-inclusive total, so the
 * rating seam priced every cached token twice — once at the input rate and
 * once at the cache-read rate. Composed here, in the composition root,
 * because the trace fold and the spend rater live in two feature packages
 * (trace-server, gateway-server) that may not import one another.
 *
 * The fixture is that call, measured through a locally lifted gateway: 4,814
 * prompt tokens of which 4,736 came from the provider's cache.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_SPEND_USAGE, NANO_USD_PER_USD, rateSpendNanoUsd } from "@langwatch/gateway-server";
import {
  ModelCatalogTraceModelCostAdapter,
  TraceCanonicalisationService,
  TraceIoExtractionAdapter,
  TraceMediaReferenceAdapter,
  TraceProjectionRuntimeService,
  TraceSpanNormalizationAdapter,
  TraceSummaryFoldProjection,
} from "@langwatch/trace-server";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import type { OtlpSpan, SpanReceivedEvent, TraceSummaryData } from "@langwatch/trace-contract";

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
 * the Go gateway, which is the single place both records get their input
 * count from. Both surfaces below are fed from here, so a surface that
 * starts reading a different quantity fails this file rather than a
 * customer's invoice.
 */
function billableInputTokens(usage: ProviderUsage): number {
  const fresh = usage.promptTokens - usage.cacheReadTokens - usage.cacheCreationTokens;
  return fresh < 0 ? usage.promptTokens : fresh;
}

/** A minimal wire-shaped `span_received` event carrying the token attributes
 *  the trace fold rates. */
function spanReceivedEvent(usage: ProviderUsage, inputTokens: number): SpanReceivedEvent {
  const attributes: Record<string, string | number> = {
    "langwatch.span.type": "llm",
    "gen_ai.request.model": usage.model,
    "gen_ai.usage.input_tokens": inputTokens,
    "gen_ai.usage.output_tokens": usage.completionTokens,
    "gen_ai.usage.cache_read.input_tokens": usage.cacheReadTokens,
    "gen_ai.usage.cache_creation.input_tokens": usage.cacheCreationTokens,
  };
  const span = {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "gen_ai.chat",
    kind: 1,
    startTimeUnixNano: "1700000000500000000",
    endTimeUnixNano: "1700000002500000000",
    attributes: Object.entries(attributes).map(([key, value]) => ({
      key,
      value:
        typeof value === "number"
          ? Number.isInteger(value)
            ? { intValue: String(value) }
            : { doubleValue: value }
          : { stringValue: value },
    })),
    events: [],
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;

  return {
    id: "evt-1",
    type: SPAN_RECEIVED_EVENT_TYPE,
    tenantId: "tenant-1",
    aggregateId: span.traceId,
    data: { span, resource: null, instrumentationScope: null, piiRedactionLevel: "DISABLED" },
    metadata: { spanId: span.spanId, traceId: span.traceId },
  } as unknown as SpanReceivedEvent;
}

/** The trace-summary fold's zeroed initial state. */
function initTraceSummaryState(): TraceSummaryData {
  return {
    traceId: "",
    spanCount: 0,
    totalDurationMs: 0,
    computedIOSchemaVersion: "2026-04-28",
    computedInput: null,
    computedOutput: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    containsPrompt: false,
    attributes: {},
    storageAnchorMs: 0,
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
  } as unknown as TraceSummaryData;
}

const runtime = TraceProjectionRuntimeService.create({
  canonicalisation: TraceCanonicalisationService.create(),
  ioExtraction: TraceIoExtractionAdapter.create(TraceCanonicalisationService.create()),
  mediaReferences: TraceMediaReferenceAdapter.create(),
  modelCosts: ModelCatalogTraceModelCostAdapter.create(),
  spanNormalization: TraceSpanNormalizationAdapter.create(TraceCanonicalisationService.create()),
});

const fold = TraceSummaryFoldProjection.create({
  store: { store: async () => {}, get: async () => null } as never,
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime,
});

/** The Usage page's number: the trace summary fold over the emitted span. */
function traceCostUsd(usage: ProviderUsage, inputTokens: number): number {
  const state = fold.handleTraceSpanReceived(
    spanReceivedEvent(usage, inputTokens),
    initTraceSummaryState(),
  );
  return state.totalCost ?? 0;
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
 * shut.
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
    });

    /** @scenario "The trace and the bill price a cached request at the same number" */
    it("charges far more when the billed input count still holds the cached tokens", () => {
      const trace = traceCostUsd(CACHED_CALL, billableInputTokens(CACHED_CALL));
      const cacheInclusive = billedCostUsd(CACHED_CALL, CACHED_CALL.promptTokens);

      expect(cacheInclusive).toBeGreaterThan(trace);
      expect(cacheInclusive / trace).toBeGreaterThan(8);
    });
  });

  describe("given a prompt with nothing cached", () => {
    /** @scenario "The trace and the bill price a cached request at the same number" */
    it("prices it the same on both surfaces, the cached-token split never engaging", () => {
      const input = billableInputTokens(UNCACHED_CALL);
      expect(input).toBe(UNCACHED_CALL.promptTokens);

      expect(
        surfaceGap(traceCostUsd(UNCACHED_CALL, input), billedCostUsd(UNCACHED_CALL, input)),
      ).toBeLessThan(ONE_MILLIONTH_OF_A_DOLLAR);
    });
  });
});
