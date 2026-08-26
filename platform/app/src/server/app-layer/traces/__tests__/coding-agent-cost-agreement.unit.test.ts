/**
 * One Claude Code model call, priced by every surface that prices anything.
 *
 * A customer meets that call's cost in at least six places: the trace header,
 * the analytics graphs (two of them, a fold and a rollup, which must not
 * disagree with each other either), the waterfall's per-span figure, the same
 * figure recomputed at read time when the stored one is missing, and the
 * running total under the terminal tab. Nothing about the code forces those to
 * be one number, and for a while they were not: a cache-heavy session read
 * 0.15 USD in the header and 0.23 in the terminal tab.
 *
 * The fixture is a real turn, taken off a local session's `api_request` log.
 * The span states how many tokens went to the cache but never how long the
 * entry lives; the lifetime follows the call's request context
 * (`llm_request.context`), measured against Claude Code's live traffic: a
 * main-thread call writes hour-long entries, a sub-agent call five-minute
 * ones. Both prices are pinned here: the charged figure a main-thread call
 * must reach on every surface, and the short-lived one a sub-agent call — or
 * a call with no stated context — stays at.
 *
 * The span goes in as claude actually emits it, bare `input_tokens` /
 * `cache_creation_tokens` under the CLI's own names, and every surface runs
 * the real normalization. Hand-writing canonical attributes here would test
 * the arithmetic while stepping around the ingest that has to supply it.
 */
import { describe, expect, it } from "vitest";
import { buildEntryTimeline } from "~/features/traces-v2/components/TraceDrawer/terminalView/terminalSession";
import type { SpanDetail } from "@langwatch/trace-contract";
import {
  createInitState,
  createSpanReceivedEvent,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import { SpanStorageMapProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.mapProjection";
import { TraceAnalyticsFoldProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import { TraceAnalyticsRollupMapProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalyticsRollup.mapProjection";
import { TraceSummaryFoldProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { SpanReceivedEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { mapNormalizedSpanToSpan } from "~/server/traces/mappers/span.mapper";
import { buildCodingAgentTranscript } from "@langwatch/coding-agent-contract";
import { AppTraceRuntime } from "~/runtime/app/features/trace";
import {
  mapSpanSummaryRow,
  type SpanSummaryQueryRow,
} from "../repositories/span-storage.clickhouse.repository";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const SPAN_ID = "bbbb000000000001";
const START_MS = 1_700_000_000_500;
const END_MS = 1_700_000_002_500;

/**
 * One real turn: two tokens of fresh input, a short reply, a large cache read,
 * and a large cache write. Cache writes dominate, which is why getting their
 * rate wrong was worth a third of the bill.
 */
const CALL = {
  model: "claude-opus-5",
  input_tokens: 2,
  output_tokens: 210,
  cache_read_tokens: 18_443,
  cache_creation_tokens: 17_854,
};

/**
 * What Anthropic charged for that turn, straight off the call's own
 * `api_request` log event. A main-thread call's writes are hour-long, and
 * every surface must reach this figure for one.
 */
const CHARGED_USD = 0.1930215;

/**
 * The same call with five-minute writes: what a sub-agent call prices at, and
 * the conservative answer for a call that states no context at all.
 */
const SHORT_LIVED_USD = 0.126069;

/**
 * Folds round their running total to six decimals, so the surfaces agree to a
 * millionth of a dollar rather than bit for bit.
 */
const CENTS_OF_A_CENT = 6;
const traceCanonicalisation = AppTraceRuntime.createCanonicalisation();

function claudeCallEvent(extra: Record<string, string | number> = {}): SpanReceivedEvent {
  return createSpanReceivedEvent({
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    name: "claude_code.llm_request",
    startTimeUnixNano: String(START_MS * 1_000_000),
    endTimeUnixNano: String(END_MS * 1_000_000),
    attributes: { ...CALL, ...extra, "langwatch.span.type": "llm" },
  });
}

type CallExtra = Record<string, string | number>;

const noopFoldStore = { store: async () => {}, get: async () => null };
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} };

/** The trace header, and the trace list's cost column. */
function traceSummaryCost(extra: CallExtra = {}): number | null {
  return new TraceSummaryFoldProjection({
    traceCanonicalisation,
    store: noopFoldStore,
  }).handleTraceSpanReceived(claudeCallEvent(extra), createInitState()).totalCost;
}

/** The analytics fold, which answers cost-over-time when the rollup cannot. */
function traceAnalyticsCost(extra: CallExtra = {}): number | null {
  const projection = new TraceAnalyticsFoldProjection({
    traceCanonicalisation,
    store: noopFoldStore,
  });
  return projection.handleTraceSpanReceived(claudeCallEvent(extra), projection.init())
    .totalCost;
}

/** The per-minute rollup the analytics graphs read by default. */
function analyticsRollupCost(extra: CallExtra = {}): number {
  return new TraceAnalyticsRollupMapProjection({
    traceCanonicalisation,
    store: noopAppendStore as never,
  }).mapTraceSpanReceived(claudeCallEvent(extra)).costSum;
}

/** `stored_spans.Cost`: the waterfall's per-span figure, and the CSV export's. */
function storedSpanCost(extra: CallExtra = {}): number | null {
  return new SpanStorageMapProjection({
    traceCanonicalisation,
    store: noopAppendStore as never,
  }).mapTraceSpanReceived(claudeCallEvent(extra)).cost;
}

/**
 * The read-time recompute, for spans stored before their cost was. The
 * repository selects the same canonical attributes ingest wrote, so the row is
 * built from the normalized span rather than from the raw wire values.
 */
function recomputedSummaryRowCost(extra: CallExtra = {}): number | null {
  const attrs = new SpanStorageMapProjection({
    traceCanonicalisation,
    store: noopAppendStore as never,
  }).mapTraceSpanReceived(claudeCallEvent(extra)).spanAttributes;
  const attr = (key: string): string => String(attrs[key] ?? "");

  return mapSpanSummaryRow({
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
    Model: attr("gen_ai.request.model"),
    ResponseModel: "",
    Cost: "",
    InputTokens: attr("gen_ai.usage.input_tokens"),
    InputAudioTokens: attr("gen_ai.usage.input_audio_tokens"),
    OutputAudioTokens: attr("gen_ai.usage.output_audio_tokens"),
    OutputTokens: attr("gen_ai.usage.output_tokens"),
    CacheReadTokens: attr("gen_ai.usage.cache_read.input_tokens"),
    CacheCreationTokens: attr("gen_ai.usage.cache_creation.input_tokens"),
    CacheCreation1hTokens: attr("gen_ai.usage.cache_creation_1h.input_tokens"),
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

/**
 * The running total under the terminal tab, through the same chain the drawer
 * uses: the stored span becomes a span detail, the detail becomes a transcript
 * entry, and the entries accumulate.
 */
function terminalFooterCost(extra: CallExtra = {}): number {
  const stored = new SpanStorageMapProjection({
    traceCanonicalisation,
    store: noopAppendStore as never,
  }).mapTraceSpanReceived(claudeCallEvent(extra));
  const span = mapNormalizedSpanToSpan(stored);

  const detail = {
    spanId: span.span_id,
    name: span.name,
    startTimeMs: span.timestamps.started_at,
    endTimeMs: span.timestamps.finished_at,
    status: "ok",
    metrics: {
      promptTokens: span.metrics?.prompt_tokens ?? null,
      completionTokens: span.metrics?.completion_tokens ?? null,
      cost: span.metrics?.cost ?? null,
    },
    params: span.params,
  } as unknown as SpanDetail;

  const transcript = buildCodingAgentTranscript({ spans: [detail], logs: [] });
  return (
    buildEntryTimeline({ entries: transcript.entries }).at(-1)?.cumulativeCostUsd ?? 0
  );
}

function allSurfaces(extra: CallExtra = {}): Record<string, number | null> {
  return {
    traceSummary: traceSummaryCost(extra),
    traceAnalytics: traceAnalyticsCost(extra),
    analyticsRollup: analyticsRollupCost(extra),
    storedSpan: storedSpanCost(extra),
    recomputedSummaryRow: recomputedSummaryRowCost(extra),
    terminalFooter: terminalFooterCost(extra),
  };
}

describe("the cost of one claude code model call", () => {
  describe("given a main-thread call (llm_request.context: interaction)", () => {
    /** @scenario "A main-thread call's cache writes price as hour-long entries" */
    it("prices the call at the amount the provider charged, on every surface", () => {
      for (const [surface, cost] of Object.entries(
        allSurfaces({ "llm_request.context": "interaction" }),
      )) {
        expect(cost, `${surface} priced the call differently`).toBeCloseTo(
          CHARGED_USD,
          CENTS_OF_A_CENT,
        );
      }
    });
  });

  describe("given a sub-agent call (llm_request.context: tool)", () => {
    /** @scenario "A sub-agent call's cache writes price as five-minute entries" */
    it("prices the writes short-lived, on every surface", () => {
      for (const [surface, cost] of Object.entries(
        allSurfaces({ "llm_request.context": "tool" }),
      )) {
        expect(cost, `${surface} priced the call differently`).toBeCloseTo(
          SHORT_LIVED_USD,
          CENTS_OF_A_CENT,
        );
      }
    });
  });

  describe("given a main-thread call known only by its query source", () => {
    /** @scenario "A main-thread call known only by its query source prices the same way" */
    it("prices the call at the charged amount, on every surface", () => {
      // Claude names the main thread twice: `llm_request.context` on the span
      // and `query_source` on the log side. The session fold reads both, so
      // the trace surfaces must too, or one span reads hour-long in the Usage
      // tab and five-minute in the trace header.
      for (const [surface, cost] of Object.entries(
        allSurfaces({ query_source: "repl_main_thread" }),
      )) {
        expect(cost, `${surface} priced the call differently`).toBeCloseTo(
          CHARGED_USD,
          CENTS_OF_A_CENT,
        );
      }
    });
  });

  describe("given a call whose cache writes carry no stated lifetime", () => {
    /** @scenario "A call with no stated context prices its writes conservatively" */
    /** @scenario "Every surface prices one call at one number" */
    it("prices it short-lived, the same on every surface a customer can read", () => {
      for (const [surface, cost] of Object.entries(allSurfaces())) {
        expect(cost, `${surface} priced the call differently`).toBeCloseTo(
          SHORT_LIVED_USD,
          CENTS_OF_A_CENT,
        );
      }
      // Never overstates: the conservative rate sits under the charged one.
      expect(SHORT_LIVED_USD).toBeLessThan(CHARGED_USD);
    });
  });

  describe("given a call whose span already states an hour-long count", () => {
    /** @scenario "A provider-stated split is never overwritten" */
    it("keeps the provider's own count over the context rule", () => {
      // A sub-agent call (5m by the rule) whose span nonetheless states the
      // full write as hour-long: the stated split must win.
      const cost = traceSummaryCost({
        "llm_request.context": "tool",
        "gen_ai.usage.cache_creation_1h.input_tokens": CALL.cache_creation_tokens,
      });
      expect(cost).toBeCloseTo(CHARGED_USD, CENTS_OF_A_CENT);
    });
  });
});
