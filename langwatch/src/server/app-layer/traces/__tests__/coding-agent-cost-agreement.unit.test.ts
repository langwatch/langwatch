/**
 * The drawer header and the terminal footer must show one number.
 *
 * They are computed by two different halves of the system: the header reads
 * the trace summary the fold projection wrote at ingest, and the footer sums
 * the transcript's model calls, whose per-call cost read-time enrichment joins
 * off the agent's own `cost_usd`. Nothing structural forces those two to
 * agree, and for a while they did not: a Claude Code trace showed 0.16 USD in
 * the header and 0.23 USD in the terminal footer for the same 843 tokens,
 * because the fold only ever saw the span, which carries no cost, so it priced
 * the call by our own token x registry arithmetic.
 *
 * This walks one real Claude Code turn through BOTH halves and compares what a
 * customer would read on each.
 */
import { describe, expect, it } from "vitest";
import { buildEntryTimeline } from "~/features/traces-v2/components/TraceDrawer/terminalView/terminalSession";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import { createTenantId } from "~/server/event-sourcing";
import {
  createInitState,
  createTestSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import {
  applySpanToSummary,
  TraceSummaryFoldProjection,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type { LogRecordReceivedEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { buildCodingAgentTranscript } from "../coding-agent-transcript.derivation";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const REQUEST_ID = "req_91f20cf56690611f";

/** What Anthropic charged for the turn, off the api_request log event. */
const REPORTED_COST = 0.2312;

const TOKENS = {
  input_tokens: 732,
  output_tokens: 111,
  cache_read_tokens: 20_540,
  cache_creation_tokens: 22_994,
};

/** The turn's span, as the trace fold sees it: tokens, model, and no cost. */
function foldedSpan() {
  return createTestSpan({
    traceId: TRACE_ID,
    name: "claude_code.llm_request",
    spanAttributes: {
      "gen_ai.request.model": "claude-opus-5[1m]",
      request_id: REQUEST_ID,
      "gen_ai.usage.input_tokens": TOKENS.input_tokens,
      "gen_ai.usage.output_tokens": TOKENS.output_tokens,
      "gen_ai.usage.cache_read.input_tokens": TOKENS.cache_read_tokens,
      "gen_ai.usage.cache_creation.input_tokens": TOKENS.cache_creation_tokens,
    },
  });
}

/** The same turn's api_request log event, carrying what it was charged. */
function apiRequestLogEvent(): LogRecordReceivedEvent {
  return {
    id: "evt-api-request",
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: TRACE_ID,
    tenantId: createTenantId("tenant-1"),
    createdAt: 1700000000000,
    occurredAt: 1700000000000,
    data: {
      traceId: TRACE_ID,
      spanId: "1122334455667788",
      timeUnixMs: 1700000000000,
      severityNumber: 9,
      severityText: "INFO",
      body: "claude_code.api_request",
      attributes: {
        "event.name": "api_request",
        request_id: REQUEST_ID,
        query_source: "repl_main_thread",
        cost_usd: String(REPORTED_COST),
      },
      resourceAttributes: {
        "service.name": "claude-code",
        "langwatch.cost.non_billable": "true",
      },
      scopeName: "com.anthropic.claude_code.events",
      scopeVersion: "2.1.162",
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

/**
 * The same span as the drawer reads it back: read-time enrichment has already
 * joined the reported cost onto `metrics.cost` by request_id, which is what
 * made the terminal footer right while the header was wrong.
 */
function enrichedSpanDetail(): SpanDetail {
  return {
    spanId: "span-1",
    name: "claude_code.llm_request",
    startTimeMs: 1_000,
    endTimeMs: 5_200,
    status: "ok",
    metrics: {
      promptTokens: TOKENS.input_tokens,
      completionTokens: TOKENS.output_tokens,
      cost: REPORTED_COST,
    },
    params: {
      model: "claude-opus-5[1m]",
      request_id: REQUEST_ID,
      input_tokens: String(TOKENS.input_tokens),
      output_tokens: String(TOKENS.output_tokens),
      cache_read_tokens: String(TOKENS.cache_read_tokens),
      cache_creation_tokens: String(TOKENS.cache_creation_tokens),
    },
  } as unknown as SpanDetail;
}

/** The cost the drawer header renders, off the trace summary. */
function headerCost(): number | null {
  const projection = new TraceSummaryFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
  const withSpan = applySpanToSummary({
    state: createInitState(),
    span: foldedSpan(),
  });
  return projection.handleTraceLogRecordReceived(apiRequestLogEvent(), withSpan)
    .totalCost;
}

/** The cost the terminal footer renders at the end of the transcript. */
function terminalFooterCost(): number {
  const transcript = buildCodingAgentTranscript({
    spans: [enrichedSpanDetail()],
    logs: [],
  });
  const timeline = buildEntryTimeline(transcript.entries);
  return timeline.at(-1)?.cumulativeCostUsd ?? 0;
}

describe("coding-agent trace cost", () => {
  describe("given a turn whose agent reported what it was charged", () => {
    /** @scenario "The drawer header and the terminal footer show one number" */
    it("shows the same cost in the drawer header and the terminal footer", () => {
      expect(headerCost()).toBeCloseTo(terminalFooterCost(), 6);
    });

    /** @scenario "The drawer header and the terminal footer show one number" */
    it("shows the reported cost rather than the registry estimate", () => {
      // The estimate for these tokens is ~0.1604, which is what both surfaces
      // would disagree over if the fold went back to pricing the span itself.
      expect(headerCost()).toBeCloseTo(REPORTED_COST, 6);
      expect(terminalFooterCost()).toBeCloseTo(REPORTED_COST, 6);
    });
  });
});
