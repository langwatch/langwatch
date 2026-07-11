/**
 * Trace-summary fold under the Claude Code ENHANCED-TELEMETRY mix (C4).
 *
 * Under the enhanced-telemetry beta there are NO synthesized spans. Claude Code
 * emits:
 *   - REAL `claude_code.tracing` `llm_request` spans carrying model / tokens /
 *     cost but NO message content, and
 *   - content LOGS (`user_prompt`, `api_response_body`) under the SAME real
 *     traceId carrying the conversation text.
 *
 * So the trace summary's headline input/output must lift from the content logs
 * (via `extractIOFromLogRecord`, exercised here through the fold), while
 * cost/tokens accumulate from the real spans. Because the synthesized spans are
 * gone (retired behind the per-project gate, C0), the same model call is only
 * ever folded once — cost/tokens are single-counted, and the content logs must
 * add ZERO cost/tokens.
 *
 * These tests fold a real-span + content-log event stream directly through the
 * projection (spans via `applySpanToSummary`, logs via
 * `handleTraceLogRecordReceived`) with no synthesized spans present.
 *
 * NOTE on the output source: the fold headline output lifts from the
 * `repl_main_thread` `api_response_body` event — the source the currently
 * shipped SDK snippet emits (OTEL_LOG_RAW_API_BODIES=1). The lighter
 * `assistant_response` event (plan §2.1, post-flip) is joined onto per-span
 * content by the C2 log-enrichment path, not by this fold, so it is not
 * exercised here.
 */
import { describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing";

import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type { LogRecordReceivedEvent } from "../../schemas/events";
import type { NormalizedSpan } from "../../schemas/spans";
import {
  applySpanToSummary,
  TraceSummaryFoldProjection,
} from "../traceSummary.foldProjection";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

const REAL_TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const INTERACTION_SPAN_ID = "77bb432be48046f6";

function makeProjection() {
  return new TraceSummaryFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

/**
 * A Claude Code content log record on the real traceId (scope
 * `com.anthropic.claude_code.events`). Content logs all carry the PARENT
 * interaction SpanId, not the llm_request SpanId (see plan §8).
 */
function makeContentLog(
  attributes: Record<string, string>,
  opts: { timeUnixMs?: number; body?: string } = {},
): LogRecordReceivedEvent {
  const time = opts.timeUnixMs ?? 1_700_000_000_000;
  return {
    id: "evt-log",
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: REAL_TRACE_ID,
    tenantId: createTenantId("tenant-1"),
    createdAt: time,
    occurredAt: time,
    data: {
      traceId: REAL_TRACE_ID,
      spanId: INTERACTION_SPAN_ID,
      timeUnixMs: time,
      severityNumber: 9,
      severityText: "INFO",
      body: opts.body ?? "claude_code.event",
      attributes,
      resourceAttributes: { "service.name": "claude-code" },
      scopeName: "com.anthropic.claude_code.events",
      scopeVersion: "2.1.162",
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

function userPromptLog(prompt: string, timeUnixMs: number): LogRecordReceivedEvent {
  return makeContentLog(
    { "event.name": "user_prompt", "session.id": "sess-1", prompt },
    { timeUnixMs, body: "claude_code.user_prompt" },
  );
}

/** The Anthropic /v1/messages response body shape carried by api_response_body. */
function responseBody(text: string): string {
  return JSON.stringify({
    model: "claude-opus-4-8",
    content: [
      { type: "thinking", thinking: "<REDACTED>" },
      { type: "text", text },
    ],
  });
}

function apiResponseLog(
  text: string,
  querySource: string,
  timeUnixMs: number,
): LogRecordReceivedEvent {
  return makeContentLog(
    {
      "event.name": "api_response_body",
      query_source: querySource,
      request_id: `req_${querySource}_${timeUnixMs}`,
      body: responseBody(text),
    },
    { timeUnixMs, body: "claude_code.api_response_body" },
  );
}

/**
 * A REAL claude_code.tracing `llm_request` span: model + tokens + cost, and NO
 * message content (content lives in the logs). These are children of the
 * interaction span, not roots.
 */
function realLlmSpan(over: {
  spanId: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model?: string;
}): NormalizedSpan {
  return createTestSpan({
    id: over.spanId,
    spanId: over.spanId,
    traceId: REAL_TRACE_ID,
    parentSpanId: INTERACTION_SPAN_ID,
    name: "claude_code.llm_request",
    startTimeUnixMs: over.startTimeUnixMs,
    endTimeUnixMs: over.endTimeUnixMs,
    durationMs: over.endTimeUnixMs - over.startTimeUnixMs,
    instrumentationScope: {
      name: "com.anthropic.claude_code.tracing",
      version: null,
    },
    spanAttributes: {
      "langwatch.span.type": "llm",
      "gen_ai.request.model": over.model ?? "claude-opus-4-8",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.usage.input_tokens": over.inputTokens,
      "gen_ai.usage.output_tokens": over.outputTokens,
      // claude reports its own billed cost per call; the fold trusts it
      // (computeSpanCost priority 2) so the cost sum is deterministic.
      "langwatch.span.cost": over.cost,
      request_id: `req_${over.spanId}`,
    },
  });
}

type StreamItem = { span: NormalizedSpan } | { log: LogRecordReceivedEvent };

function foldStream(items: StreamItem[]): TraceSummaryData {
  const projection = makeProjection();
  let state = createInitState();
  for (const item of items) {
    state =
      "span" in item
        ? applySpanToSummary({ state, span: item.span })
        : projection.handleTraceLogRecordReceived(item.log, state);
  }
  return state;
}

const REPLY = "The answer is 4.";

describe("TraceSummaryFoldProjection — Claude Code enhanced-telemetry mix", () => {
  describe("given real llm_request spans plus content logs under one real traceId", () => {
    describe("when a user_prompt content log is folded", () => {
      it("lifts the headline input from the user_prompt `prompt` attribute", () => {
        const state = foldStream([
          { log: userPromptLog("What is 2+2?", 1000) },
          {
            span: realLlmSpan({
              spanId: "llm-1",
              startTimeUnixMs: 1100,
              endTimeUnixMs: 2000,
              inputTokens: 100,
              outputTokens: 20,
              cost: 0.01,
            }),
          },
        ]);

        // Input comes from the content log; the real span carries no content.
        expect(state.computedInput).toBe("What is 2+2?");
        expect(state.attributes["langwatch.input"]).toBe("What is 2+2?");
      });
    });

    describe("when the main-thread api_response_body content log is folded", () => {
      it("lifts the headline output from the repl_main_thread reply", () => {
        const state = foldStream([
          { log: userPromptLog("What is 2+2?", 1000) },
          {
            span: realLlmSpan({
              spanId: "llm-1",
              startTimeUnixMs: 1100,
              endTimeUnixMs: 2000,
              inputTokens: 100,
              outputTokens: 20,
              cost: 0.01,
            }),
          },
          { log: apiResponseLog(REPLY, "repl_main_thread", 2100) },
        ]);

        expect(state.computedInput).toBe("What is 2+2?");
        expect(state.computedOutput).toBe(REPLY);
      });
    });

    describe("when a sub-agent api_response_body lands under the same real traceId", () => {
      it("does not let the sub-agent reply win the headline output", () => {
        // A builtin sub-agent's api_response_body shares the real traceId but is
        // NOT the conversation — the CONVERSATIONAL_QUERY_SOURCES gate excludes
        // it. Fold it AFTER the real reply (latest end time) to prove end-time
        // ordering doesn't let it through.
        const state = foldStream([
          { log: userPromptLog("Build the feature", 1000) },
          {
            span: realLlmSpan({
              spanId: "llm-main",
              startTimeUnixMs: 1100,
              endTimeUnixMs: 2000,
              inputTokens: 100,
              outputTokens: 20,
              cost: 0.01,
            }),
          },
          { log: apiResponseLog(REPLY, "repl_main_thread", 2100) },
          {
            span: realLlmSpan({
              spanId: "llm-subagent",
              startTimeUnixMs: 2200,
              endTimeUnixMs: 3000,
              inputTokens: 500,
              outputTokens: 60,
              cost: 0.02,
            }),
          },
          {
            log: apiResponseLog(
              "Sub-agent internal chatter that must not surface",
              "agent:builtin:general-purpose",
              3100,
            ),
          },
        ]);

        // The headline stays the main-thread reply.
        expect(state.computedOutput).toBe(REPLY);
        expect(state.computedOutput).not.toContain("Sub-agent");
      });
    });

    describe("when a utility call (generate_session_title) emits output", () => {
      it("does not let the utility text clobber the real reply", () => {
        const state = foldStream([
          { log: userPromptLog("What is 2+2?", 1000) },
          { log: apiResponseLog(REPLY, "repl_main_thread", 2100) },
          // The haiku-generated title fires later but is a utility call — its
          // text is NOT the assistant's reply.
          {
            log: apiResponseLog(
              "A conversation about basic arithmetic",
              "generate_session_title",
              2200,
            ),
          },
          // The autosuggest also fires after the reply.
          {
            log: apiResponseLog(
              "continue",
              "prompt_suggestion",
              2300,
            ),
          },
        ]);

        expect(state.computedOutput).toBe(REPLY);
      });
    });

    describe("when cost/tokens accumulate from the real llm_request spans", () => {
      it("single-counts usage — content logs add zero cost/tokens", () => {
        const turn1 = realLlmSpan({
          spanId: "llm-1",
          startTimeUnixMs: 1100,
          endTimeUnixMs: 2000,
          inputTokens: 100,
          outputTokens: 20,
          cost: 0.01,
        });
        const turn2 = realLlmSpan({
          spanId: "llm-2",
          startTimeUnixMs: 3000,
          endTimeUnixMs: 4000,
          inputTokens: 200,
          outputTokens: 30,
          cost: 0.02,
        });

        // Real spans only (the source of truth for cost/tokens).
        const spansOnly = foldStream([{ span: turn1 }, { span: turn2 }]);

        // The same spans PLUS the content logs that carry the conversation.
        // Under the OLD synthesis path, api_response_body became a SECOND span
        // and doubled the cost/tokens. Under enhanced telemetry it stays a log:
        // it must add text but ZERO cost/tokens.
        const spansPlusLogs = foldStream([
          { log: userPromptLog("What is 2+2?", 1000) },
          { span: turn1 },
          { log: apiResponseLog(REPLY, "repl_main_thread", 2100) },
          { span: turn2 },
          { log: apiResponseLog(REPLY, "repl_main_thread", 4100) },
        ]);

        // Absolute sums from the real spans.
        expect(spansOnly.totalPromptTokenCount).toBe(300);
        expect(spansOnly.totalCompletionTokenCount).toBe(50);
        expect(spansOnly.totalCost).toBe(0.03);

        // Content logs contribute the conversation but NOT a second copy of the
        // usage — the totals are identical with the logs folded in.
        expect(spansPlusLogs.totalPromptTokenCount).toBe(
          spansOnly.totalPromptTokenCount,
        );
        expect(spansPlusLogs.totalCompletionTokenCount).toBe(
          spansOnly.totalCompletionTokenCount,
        );
        expect(spansPlusLogs.totalCost).toBe(spansOnly.totalCost);

        // And the logs did populate the headline I/O.
        expect(spansPlusLogs.computedInput).toBe("What is 2+2?");
        expect(spansPlusLogs.computedOutput).toBe(REPLY);
      });
    });

    describe("when the api_request_body was truncated at the source", () => {
      it("still resolves the headline input from the co-located user_prompt", () => {
        // A truncated api_request_body is invalid JSON and yields no input on
        // its own; the co-located user_prompt still carries the clean turn text.
        // Fold the truncated body BEFORE and the prompt AFTER to prove the
        // prompt wins regardless of order.
        const truncatedRequestBody = makeContentLog(
          {
            "event.name": "api_request_body",
            query_source: "repl_main_thread",
            body_truncated: "true",
            // A body cut mid-object: unparseable, no recoverable input text.
            body: '{"model":"claude-opus-4-8","messages":[{"role":"user","content":"What is 2+',
          },
          { timeUnixMs: 1000, body: "claude_code.api_request_body" },
        );

        const state = foldStream([
          { log: truncatedRequestBody },
          { log: userPromptLog("What is 2+2?", 1010) },
          {
            span: realLlmSpan({
              spanId: "llm-1",
              startTimeUnixMs: 1100,
              endTimeUnixMs: 2000,
              inputTokens: 100,
              outputTokens: 20,
              cost: 0.01,
            }),
          },
        ]);

        expect(state.computedInput).toBe("What is 2+2?");
        // The raw truncated request JSON never leaks into the headline input.
        expect(state.computedInput).not.toContain("messages");
      });
    });
  });

  describe("given a Claude session trace with thousands of spans", () => {
    describe("when an llm_request span arrives far past the old 512-span cap", () => {
      it("keeps deriving, so a long session's usage is not under-counted", () => {
        // Claude's native tracer groups a whole SESSION under one traceId — a
        // real session measured against this branch had 796 spans, 34 model
        // calls and 192 tool runs, so an ordinary session sails past 512.
        //
        // Derivation used to STOP at that cap, which meant a Claude session's
        // cost and tokens silently froze partway through, and the coding-agent
        // summary never saw the FINAL llm_request — which is exactly where
        // `stop_reason` lives, so a truncated reply could never be detected. The
        // cap corrupted the traces it was least equipped to describe.
        //
        // The runaway-trace guard the cap was really for now lives where it
        // belongs: MAX_EVAL_DISPATCH_SPANS, which drops the eval WORK, never the
        // DATA.
        const longSession: TraceSummaryData = {
          ...createInitState(),
          traceId: REAL_TRACE_ID,
          spanCount: 2_000,
          models: ["claude-opus-4-8"],
          totalPromptTokenCount: 1_000_000,
          totalCompletionTokenCount: 50_000,
        };

        // The 2001st span of the session — a real model call with real usage.
        const after = applySpanToSummary({
          state: longSession,
          span: realLlmSpan({
            spanId: "llm-2001",
            startTimeUnixMs: 900_000,
            endTimeUnixMs: 901_000,
            inputTokens: 900,
            outputTokens: 100,
            cost: 0.05,
          }),
        });

        // The late span's usage is COUNTED — no freeze.
        expect(after.totalPromptTokenCount).toBe(1_000_900);
        expect(after.totalCompletionTokenCount).toBe(50_100);
        expect(after.totalCost).toBeCloseTo(0.05);
      });
    });
  });
});
