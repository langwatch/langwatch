/**
 * One Claude Code model call, priced by every server-side surface that prices
 * anything. Nothing forces those to be one number, and for a while they were
 * not: a cache-heavy session read 0.15 USD in the header and 0.23 elsewhere.
 */

// The terminal tab's own accumulation is pinned in `@langwatch/coding-agent-web`'s
// `terminal-session.unit.test.ts`. The span goes in as claude emits it, under
// the CLI's own names, and every surface runs the real normalisation.
// See specs/coding-agent/cache-write-ttl-pricing.feature.
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { SpanStorageClickHouseRepository } from "../../repositories/clickhouse/span-storage.repository.ts";
import type { SpanSummaryQueryRow } from "../../repositories/clickhouse/span-storage.repository.ts";
import { TraceCanonicalisationService } from "../../services/canonicalisers/trace-canonicalisation.service.ts";
import { SpanStorageMapProjection } from "../span-storage.projection.ts";
import { TraceAnalyticsFoldProjection } from "../trace-derived.projection.ts";
import { TraceAnalyticsRollupMapProjection } from "../trace-rollup.projection.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import { createSpanReceivedEvent, createTestRuntime } from "./fixtures/trace-summary-test.fixtures.ts";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const SPAN_ID = "bbbb000000000001";
const START_MS = 1_700_000_000_500;
const END_MS = 1_700_000_002_500;

/** One real turn: two tokens of fresh input, a short reply, a large cache read
 *  and a large cache write. Cache writes dominate, which is why getting their
 *  rate wrong was worth a third of the bill. */
const CALL = {
  model: "claude-opus-5",
  input_tokens: 2,
  output_tokens: 210,
  cache_read_tokens: 18_443,
  cache_creation_tokens: 17_854,
};

/** What the provider charged for that turn, with hour-long cache writes. */
const CHARGED_USD = 0.1930215;

/** The same call with five-minute writes: what a call stating no context is priced at. */
const SHORT_LIVED_USD = 0.126069;

/** Folds round their running total, so the surfaces agree to a millionth of a dollar. */
const CENTS_OF_A_CENT = 6;

type CallExtra = Record<string, string | number>;

const runtime = createTestRuntime();
const noopFoldStore = { store: async () => {}, tryGet: async () => null };
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} } as never;

function claudeCallEvent(extra: CallExtra = {}): SpanReceivedEvent {
  return createSpanReceivedEvent({
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    name: "claude_code.llm_request",
    startTimeUnixNano: String(START_MS * 1_000_000),
    endTimeUnixNano: String(END_MS * 1_000_000),
    attributes: { ...CALL, ...extra, "langwatch.span.type": "llm" },
  });
}

/** The trace header, and the trace list's cost column. */
function traceSummaryCost(extra: CallExtra): number | null {
  const projection = TraceSummaryFoldProjection.create({
    store: noopFoldStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime,
  });
  return projection.handleTraceSpanReceived(claudeCallEvent(extra), projection.init()).totalCost;
}

/** The analytics fold, which answers cost-over-time when the rollup cannot. */
function traceAnalyticsCost(extra: CallExtra): number | null {
  const projection = TraceAnalyticsFoldProjection.create({
    store: noopFoldStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime,
  });
  return projection.handleTraceSpanReceived(claudeCallEvent(extra), projection.init()).totalCost;
}

/** The per-minute rollup the analytics graphs read by default. */
function analyticsRollupCost(extra: CallExtra): number {
  return TraceAnalyticsRollupMapProjection.create({
    store: noopAppendStore,
    spanCostService: runtime.spanCost,
    spanNormalization: runtime.spanNormalization,
  }).mapTraceSpanReceived(claudeCallEvent(extra)).costSum;
}

function storedSpan(extra: CallExtra) {
  return SpanStorageMapProjection.create({
    store: noopAppendStore,
    spanCostService: runtime.spanCost,
    spanNormalization: runtime.spanNormalization,
  }).mapTraceSpanReceived(claudeCallEvent(extra));
}

/** `stored_spans.Cost`: the waterfall's per-span figure, and the export's. */
function storedSpanCost(extra: CallExtra): number | null {
  return storedSpan(extra).cost ?? null;
}

/** The read-time recompute, for spans stored before their cost was. The row is
 *  built from the normalized span rather than the raw wire values, since the
 *  repository selects the canonical attributes ingest wrote. */
function recomputedSummaryRowCost(extra: CallExtra): number | null {
  const attributes = storedSpan(extra).spanAttributes as Record<string, unknown>;
  const attribute = (key: string): string => String(attributes[key] ?? "");

  return SpanStorageClickHouseRepository.mapSpanSummaryRow({
    SpanId: SPAN_ID,
    ParentSpanId: null,
    SpanName: "claude_code.llm_request",
    DurationMs: END_MS - START_MS,
    StatusCode: null,
    SpanType: "llm",
    ToolName: "",
    RequestId: "",
    QuerySource: "",
    ToolUseId: "",
    Model: attribute("gen_ai.request.model"),
    ResponseModel: "",
    Cost: "",
    InputTokens: attribute("gen_ai.usage.input_tokens"),
    InputAudioTokens: attribute("gen_ai.usage.input_audio_tokens"),
    OutputAudioTokens: attribute("gen_ai.usage.output_audio_tokens"),
    InputImageTokens: attribute("gen_ai.usage.input_image_tokens"),
    OutputImageTokens: attribute("gen_ai.usage.output_image_tokens"),
    OutputTokens: attribute("gen_ai.usage.output_tokens"),
    CacheReadTokens: attribute("gen_ai.usage.cache_read.input_tokens"),
    CacheCreationTokens: attribute("gen_ai.usage.cache_creation.input_tokens"),
    CacheCreation1hTokens: attribute("gen_ai.usage.cache_creation_1h.input_tokens"),
    InputChars: "",
    AudioSeconds: "",
    CustomInputRate: "",
    CustomOutputRate: "",
    CustomCacheReadRate: "",
    CustomCacheCreationRate: "",
    CustomCacheCreation1hRate: "",
    LwSpanCost: "",
    StartTimeMs: START_MS,
    UpdatedAtMs: START_MS,
  } satisfies SpanSummaryQueryRow).cost;
}

function allSurfaces(extra: CallExtra = {}): Record<string, number | null> {
  return {
    traceSummary: traceSummaryCost(extra),
    traceAnalytics: traceAnalyticsCost(extra),
    analyticsRollup: analyticsRollupCost(extra),
    storedSpan: storedSpanCost(extra),
    recomputedSummaryRow: recomputedSummaryRowCost(extra),
  };
}

function expectEverySurfaceAt(extra: CallExtra, expected: number): void {
  for (const [surface, cost] of Object.entries(allSurfaces(extra))) {
    expect(cost, `${surface} priced the call differently`).toBeCloseTo(expected, CENTS_OF_A_CENT);
  }
}

describe("the cost of one claude code model call", () => {
  describe("given a main-thread call, whose cache writes are hour-long", () => {
    describe("when every surface prices it", () => {
      /** @scenario "A trace rollup projection totals a call the same as every other pricing surface" */
      /** @scenario Every surface prices one call at one number */
      it("reaches the amount the provider charged, on all of them", () => {
        expectEverySurfaceAt({ "llm_request.context": "interaction" }, CHARGED_USD);
      });
    });
  });

  describe("given a call whose cache writes carry no stated lifetime", () => {
    describe("when every surface prices it", () => {
      /** @scenario Every surface prices one call at one number */
      it("prices the writes short-lived, the same on all of them", () => {
        expectEverySurfaceAt({}, SHORT_LIVED_USD);
        // Never overstates: the conservative rate sits under the charged one.
        expect(SHORT_LIVED_USD).toBeLessThan(CHARGED_USD);
      });
    });
  });
});
