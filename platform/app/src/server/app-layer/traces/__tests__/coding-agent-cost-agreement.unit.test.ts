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
 * entry lives, so the writes price short-lived and the figure sits under what
 * Anthropic charged. Both numbers are pinned here: the one every surface must
 * agree on, and the bill it does not yet reach.
 *
 * The span goes in as claude actually emits it, bare `input_tokens` /
 * `cache_creation_tokens` under the CLI's own names, and every surface runs
 * the real normalization. Hand-writing canonical attributes here would test
 * the arithmetic while stepping around the ingest that has to supply it.
 */
import { describe, expect, it } from "vitest";
import { buildEntryTimeline } from "~/features/traces-v2/components/TraceDrawer/terminalView/terminalSession";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
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
import { buildCodingAgentTranscript } from "../coding-agent-transcript.derivation";
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
 * `api_request` log event. Not read at runtime, and deliberately not what the
 * surfaces are asserted against: reaching it needs the provider's own 5m/1h
 * breakdown on the span, which arrives on the log stream instead. It is pinned
 * so the size of that gap is visible rather than folklore.
 */
const CHARGED_USD = 0.1930215;

/**
 * What the surfaces do compute: every cache write priced short-lived, which is
 * the only rate a span with no stated lifetime supports.
 */
const SHORT_LIVED_USD = 0.126069;

/**
 * Folds round their running total to six decimals, so the surfaces agree to a
 * millionth of a dollar rather than bit for bit.
 */
const CENTS_OF_A_CENT = 6;

function claudeCallEvent(): SpanReceivedEvent {
  return createSpanReceivedEvent({
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    name: "claude_code.llm_request",
    startTimeUnixNano: String(START_MS * 1_000_000),
    endTimeUnixNano: String(END_MS * 1_000_000),
    attributes: { ...CALL, "langwatch.span.type": "llm" },
  });
}

const noopFoldStore = { store: async () => {}, get: async () => null };
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} };

/** The trace header, and the trace list's cost column. */
function traceSummaryCost(): number | null {
  return new TraceSummaryFoldProjection({
    store: noopFoldStore,
  }).handleTraceSpanReceived(claudeCallEvent(), createInitState()).totalCost;
}

/** The analytics fold, which answers cost-over-time when the rollup cannot. */
function traceAnalyticsCost(): number | null {
  const projection = new TraceAnalyticsFoldProjection({
    store: noopFoldStore,
  });
  return projection.handleTraceSpanReceived(
    claudeCallEvent(),
    projection.init(),
  ).totalCost;
}

/** The per-minute rollup the analytics graphs read by default. */
function analyticsRollupCost(): number {
  return new TraceAnalyticsRollupMapProjection({
    store: noopAppendStore as never,
  }).mapTraceSpanReceived(claudeCallEvent()).costSum;
}

/** `stored_spans.Cost`: the waterfall's per-span figure, and the CSV export's. */
function storedSpanCost(): number | null {
  return new SpanStorageMapProjection({
    store: noopAppendStore as never,
  }).mapTraceSpanReceived(claudeCallEvent()).cost;
}

/**
 * The read-time recompute, for spans stored before their cost was. The
 * repository selects the same canonical attributes ingest wrote, so the row is
 * built from the normalized span rather than from the raw wire values.
 */
function recomputedSummaryRowCost(): number | null {
  const attrs = new SpanStorageMapProjection({
    store: noopAppendStore as never,
  }).mapTraceSpanReceived(claudeCallEvent()).spanAttributes;
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
function terminalFooterCost(): number {
  const stored = new SpanStorageMapProjection({
    store: noopAppendStore as never,
  }).mapTraceSpanReceived(claudeCallEvent());
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
  return buildEntryTimeline(transcript.entries).at(-1)?.cumulativeCostUsd ?? 0;
}

describe("the cost of one claude code model call", () => {
  describe("given a call whose cache writes carry no stated lifetime", () => {
    /** @scenario "Every surface prices one call at one number" */
    it("prices it the same on every surface a customer can read", () => {
      const surfaces = {
        traceSummary: traceSummaryCost(),
        traceAnalytics: traceAnalyticsCost(),
        analyticsRollup: analyticsRollupCost(),
        storedSpan: storedSpanCost(),
        recomputedSummaryRow: recomputedSummaryRowCost(),
        terminalFooter: terminalFooterCost(),
      };

      for (const [surface, cost] of Object.entries(surfaces)) {
        expect(cost, `${surface} priced the call differently`).toBeCloseTo(
          SHORT_LIVED_USD,
          CENTS_OF_A_CENT,
        );
      }
    });

    /** @scenario "A call that does not say how long its cache lives is priced as before" */
    it("prices the writes short-lived, below what the provider charged", () => {
      // The distance between these two is what carrying the provider's own
      // 5m/1h breakdown onto the span would close.
      expect(traceSummaryCost()).toBeCloseTo(SHORT_LIVED_USD, CENTS_OF_A_CENT);
      expect(SHORT_LIVED_USD).toBeLessThan(CHARGED_USD);
    });
  });
});
