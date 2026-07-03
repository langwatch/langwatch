/**
 * Fold-side session-step accumulation (ADR-033 PR C). Verifies the trace fold
 * appends `{ startMs, inputTokens }` to the bounded `langwatch.reserved.session_steps`
 * series for coding-agent LLM steps on BOTH the span path (`applySpanToSummary`)
 * and the Path B log path (`handleTraceLogRecordReceived`), and stays inert for
 * non-coding-agent traffic. The compaction + rollup logic over these steps is
 * tested in session-rollup/__tests__/sessionRollup.service.unit.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  InputCategory,
} from "~/server/app-layer/traces/block-classification/categories";
import {
  parseSessionSteps,
  SESSION_HARNESS_ATTR,
  SESSION_STEPS_ATTR,
} from "~/server/app-layer/traces/session-rollup/sessionSteps";
import { createTenantId } from "~/server/event-sourcing";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type { LogRecordReceivedEvent } from "../../schemas/events";
import {
  applySpanToSummary,
  TraceSummaryFoldProjection,
} from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

const CODEX_SCOPE = { name: "codex_cli_rs", version: null };

describe("applySpanToSummary session-step accumulation", () => {
  describe("given a coding-agent LLM span with input usage", () => {
    describe("when it is folded", () => {
      it("appends a step and stamps the harness marker", () => {
        const span = createTestSpan({
          startTimeUnixMs: 42_000,
          instrumentationScope: CODEX_SCOPE,
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 5000,
            "gen_ai.usage.output_tokens": 20,
          },
        });

        const state = applySpanToSummary({ state: createInitState(), span });

        expect(parseSessionSteps(state.attributes[SESSION_STEPS_ATTR])).toEqual(
          [{ startMs: 42_000, inputTokens: 5000 }],
        );
        expect(state.attributes[SESSION_HARNESS_ATTR]).toBe("codex");
      });
    });
  });

  describe("given a coding-agent span with cache-read usage", () => {
    describe("when it is folded", () => {
      it("counts the whole prompt context (fresh + cache-read + cache-creation)", () => {
        const span = createTestSpan({
          startTimeUnixMs: 1000,
          instrumentationScope: CODEX_SCOPE,
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 2000,
            "gen_ai.usage.cache_read.input_tokens": 30_000,
            "gen_ai.usage.cache_creation.input_tokens": 8000,
            "gen_ai.usage.output_tokens": 20,
          },
        });

        const state = applySpanToSummary({ state: createInitState(), span });

        expect(parseSessionSteps(state.attributes[SESSION_STEPS_ATTR])).toEqual(
          [{ startMs: 1000, inputTokens: 40_000 }],
        );
      });
    });
  });

  describe("given a claude-code span carrying only per-category block totals", () => {
    describe("when it is folded", () => {
      it("appends a step even with zero fresh input tokens", () => {
        const span = createTestSpan({
          startTimeUnixMs: 7000,
          spanAttributes: {
            "gen_ai.system": "claude_code",
            [blockCategoryTokensAttr(InputCategory.SYSTEM_PROMPT)]: "100",
            [blockCategoryCostAttr(InputCategory.SYSTEM_PROMPT)]: "0.001",
          },
        });

        const state = applySpanToSummary({ state: createInitState(), span });

        expect(parseSessionSteps(state.attributes[SESSION_STEPS_ATTR])).toEqual(
          [{ startMs: 7000, inputTokens: 0 }],
        );
        expect(state.attributes[SESSION_HARNESS_ATTR]).toBe("claude");
      });
    });
  });

  describe("given a non-coding-agent span", () => {
    describe("when it is folded", () => {
      it("appends no step", () => {
        const span = createTestSpan({
          instrumentationScope: { name: "openai", version: null },
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 5000,
          },
        });

        const state = applySpanToSummary({ state: createInitState(), span });

        expect(state.attributes[SESSION_STEPS_ATTR]).toBeUndefined();
        expect(state.attributes[SESSION_HARNESS_ATTR]).toBeUndefined();
      });
    });
  });

  describe("given a coding-agent span flagged as a redundant usage copy", () => {
    describe("when it is folded after the turn's rollup span", () => {
      it("appends no duplicate step", () => {
        const turnSpan = createTestSpan({
          startTimeUnixMs: 1000,
          instrumentationScope: CODEX_SCOPE,
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 5000,
          },
        });
        const redundantSpan = createTestSpan({
          startTimeUnixMs: 1000,
          instrumentationScope: CODEX_SCOPE,
          spanAttributes: {
            "gen_ai.usage.input_tokens": 5000,
            "langwatch.reserved.skip_token_accumulation": "true",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: turnSpan });
        state = applySpanToSummary({ state, span: redundantSpan });

        expect(parseSessionSteps(state.attributes[SESSION_STEPS_ATTR])).toEqual(
          [{ startMs: 1000, inputTokens: 5000 }],
        );
      });
    });
  });
});

function makeCodexSseLogEvent(
  attrs: Record<string, string>,
  timeUnixMs: number,
): LogRecordReceivedEvent {
  return {
    id: "evt-log",
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    tenantId: createTenantId("tenant-1"),
    createdAt: timeUnixMs,
    occurredAt: timeUnixMs,
    data: {
      traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      spanId: "1122334455667788",
      timeUnixMs,
      severityNumber: 9,
      severityText: "INFO",
      body: "codex.sse_event",
      attributes: { "event.name": "codex.sse_event", ...attrs },
      resourceAttributes: { "service.name": "codex" },
      // Codex does not pin its log scope name across releases.
      scopeName: "codex",
      scopeVersion: null,
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

describe("handleTraceLogRecordReceived session-step accumulation", () => {
  describe("given a codex sse log turn with a thread id and input usage", () => {
    describe("when it is folded", () => {
      it("appends a step summing fresh + cache-read input tokens", () => {
        const projection = new TraceSummaryFoldProjection({
          store: { store: async () => {}, get: async () => null },
        });

        const state = projection.handleTraceLogRecordReceived(
          makeCodexSseLogEvent(
            {
              model: "gpt-5-mini",
              input_token_count: "3000",
              output_token_count: "50",
              cached_token_count: "12000",
              "conversation.id": "codex-thread-1",
            },
            1_700_000_000_000,
          ),
          createInitState(),
        );

        expect(parseSessionSteps(state.attributes[SESSION_STEPS_ATTR])).toEqual(
          [{ startMs: 1_700_000_000_000, inputTokens: 15_000 }],
        );
        expect(state.attributes[SESSION_HARNESS_ATTR]).toBe("codex");
        expect(state.attributes["langwatch.thread.id"]).toBe("codex-thread-1");
      });
    });
  });

  describe("given a log turn with no coding-agent thread id", () => {
    describe("when it is folded", () => {
      it("appends no step", () => {
        const projection = new TraceSummaryFoldProjection({
          store: { store: async () => {}, get: async () => null },
        });

        const state = projection.handleTraceLogRecordReceived(
          makeCodexSseLogEvent(
            { model: "gpt-5-mini", input_token_count: "3000" },
            1_700_000_000_000,
          ),
          createInitState(),
        );

        expect(state.attributes[SESSION_STEPS_ATTR]).toBeUndefined();
      });
    });
  });
});
