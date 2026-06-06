/**
 * Fold-projection log-lift regression tests for the events that REMAIN on
 * the log path: claude_code `user_prompt`, codex (`codex.sse_event` /
 * `codex.conversation_starts`), and the gemini / gen_ai.* defensive lift.
 *
 * The claude_code model-call triplet (api_request / api_request_body /
 * api_response_body) is trapped at ingest and converted into a gen_ai span
 * (see claude-code-log-to-span.unit.test.ts) — it NO LONGER lifts model /
 * cost / tokens / output through the log fold. The "does NOT lift a converted
 * api_request" case below pins that: even if one ever reached the log path it
 * must be a no-op so cost/tokens can never be double-counted.
 *
 * The top-level column mirror (langwatch.* lift -> Models /
 * TotalPromptTokenCount / TotalCompletionTokenCount) stays live for the
 * log-path emitters and is exercised here through codex.sse_event. Claude's
 * cost/tokens now mirror onto the top-level columns via the SPAN fold
 * (computeSpanCost + accumulateTokens), covered in the converter + service
 * tests.
 */
import { describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing";

import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type { LogRecordReceivedEvent } from "../../schemas/events";
import { TraceSummaryFoldProjection } from "../traceSummary.foldProjection";
import { createInitState } from "./fixtures/trace-summary-test.fixtures";

function makeProjection() {
  return new TraceSummaryFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

function makeLogEvent(
  attrs: Record<string, string>,
  opts: { scopeName?: string; body?: string } = {},
): LogRecordReceivedEvent {
  return {
    id: `evt-log`,
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    tenantId: createTenantId("tenant-1"),
    createdAt: 1700000000000,
    occurredAt: 1700000000000,
    data: {
      traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      spanId: "1122334455667788",
      timeUnixMs: 1700000000000,
      severityNumber: 9,
      severityText: "INFO",
      body: opts.body ?? "log",
      attributes: attrs,
      resourceAttributes: { "service.name": "claude-code" },
      scopeName: opts.scopeName ?? "com.anthropic.claude_code.events",
      scopeVersion: "2.1.162",
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

describe("TraceSummaryFoldProjection — log-path lift", () => {
  describe("when the record is a claude_code user_prompt", () => {
    it("lifts the prompt + thread.id and leaves cost/tokens/model untouched", () => {
      const projection = makeProjection();
      const state = createInitState();

      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          {
            "event.name": "user_prompt",
            "session.id": "s",
            prompt: "What is 2+2?",
          },
          { body: "claude_code.user_prompt" },
        ),
        state,
      );

      expect(after.attributes["langwatch.input"]).toBe("What is 2+2?");
      expect(after.attributes["langwatch.thread.id"]).toBe("s");
      expect(after.computedInput).toBe("What is 2+2?");
      // user_prompt never carries model/cost/tokens.
      expect(after.attributes["langwatch.cost.usd"]).toBeUndefined();
      expect(after.attributes["langwatch.input_tokens"]).toBeUndefined();
      expect(after.attributes["langwatch.model"]).toBeUndefined();
    });

    it("ignores `prompt` on non-user_prompt claude_code events (subagent pollution guard)", () => {
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          { "event.name": "tool_call", "session.id": "s", prompt: "env" },
          { body: "claude_code.tool_call" },
        ),
        state,
      );
      expect(after.computedInput).toBe(state.computedInput);
      expect(after.attributes["langwatch.input"]).toBeUndefined();
    });
  });

  describe("when a converted model-call event reaches the log fold", () => {
    it("does NOT lift model/cost/tokens off an api_request (no double-count)", () => {
      // api_request is converted to a span at ingest and never reaches the
      // log path; if one ever did, the fold must NOT re-lift its cost/tokens
      // — that would double-count against the span fold's contribution.
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          {
            "event.name": "api_request",
            "session.id": "s",
            model: "claude-opus-4-7",
            cost_usd: "0.5",
            input_tokens: "100",
            output_tokens: "50",
          },
          { body: "claude_code.api_request" },
        ),
        state,
      );
      expect(after.attributes["langwatch.cost.usd"]).toBeUndefined();
      expect(after.attributes["langwatch.model"]).toBeUndefined();
      expect(after.totalCost).toBe(state.totalCost);
      expect(after.models).toEqual(state.models);
    });
  });

  describe("when api_request comes from a non-claude scope", () => {
    it("does NOT misfire on a codex api_request even with the same event.name", () => {
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          {
            "event.name": "api_request",
            "session.id": "s",
            model: "gpt-5",
            cost_usd: "0.5",
          },
          { scopeName: "com.openai.codex.events" },
        ),
        state,
      );
      expect(after.attributes["langwatch.cost.usd"]).toBeUndefined();
      expect(after.attributes["langwatch.model"]).toBeUndefined();
    });
  });

  describe("codex.sse_event lift", () => {
    /**
     * Codex emits cost-bearing turns as codex.sse_event with model +
     * token counts + conversation.id + user.email. No cost field on the
     * wire — downstream model-pricing fills cost from (model, tokens).
     */
    it("lifts model + token counts + thread.id + principal", () => {
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          {
            "event.name": "codex.sse_event",
            model: "gpt-5.5",
            input_token_count: "9700",
            output_token_count: "47",
            cached_token_count: "1200",
            "conversation.id": "conv_abc",
            "user.email": "rogerio@langwatch.ai",
          },
          { scopeName: "codex_exec", body: "codex.sse_event" },
        ),
        state,
      );
      expect(after.attributes["langwatch.model"]).toBe("gpt-5.5");
      expect(after.attributes["langwatch.input_tokens"]).toBe("9700");
      expect(after.attributes["langwatch.output_tokens"]).toBe("47");
      expect(after.attributes["langwatch.cache_read_tokens"]).toBe("1200");
      expect(after.attributes["langwatch.thread.id"]).toBe("conv_abc");
      expect(after.attributes["langwatch.principal.email"]).toBe(
        "rogerio@langwatch.ai",
      );
    });

    it("does NOT set langwatch.cache_creation_tokens for codex (codex doesn't emit it)", () => {
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          {
            "event.name": "codex.sse_event",
            model: "gpt-5.5",
            input_token_count: "100",
            output_token_count: "20",
          },
          { body: "codex.sse_event" },
        ),
        state,
      );
      expect(after.attributes["langwatch.cache_creation_tokens"]).toBeUndefined();
    });
  });

  describe("codex.conversation_starts lift", () => {
    it("lifts model + principal even before the first sse_event arrives", () => {
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          {
            "event.name": "codex.conversation_starts",
            model: "gpt-5.5",
            "user.email": "rogerio@langwatch.ai",
            "conversation.id": "conv_x",
          },
          { body: "codex.conversation_starts" },
        ),
        state,
      );
      expect(after.attributes["langwatch.model"]).toBe("gpt-5.5");
      expect(after.attributes["langwatch.principal.email"]).toBe(
        "rogerio@langwatch.ai",
      );
    });
  });

  describe("gemini / gen_ai.* defensive lift", () => {
    it("lifts every gen_ai canonical field a gemini log carries", () => {
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          {
            "gen_ai.request.model": "gemini-2.0-flash",
            "gen_ai.usage.input_tokens": "150",
            "gen_ai.usage.output_tokens": "30",
            "gen_ai.conversation.id": "conv_g",
            "gen_ai.input.messages": '[{"role":"user","content":"Hi"}]',
            "gen_ai.output.messages":
              '[{"role":"assistant","content":"Hello"}]',
            cached_content_token_count: "7",
          },
          { scopeName: "gen_ai", body: "gen_ai.event" },
        ),
        state,
      );
      expect(after.attributes["langwatch.model"]).toBe("gemini-2.0-flash");
      expect(after.attributes["langwatch.input_tokens"]).toBe("150");
      expect(after.attributes["langwatch.output_tokens"]).toBe("30");
      expect(after.attributes["langwatch.cache_read_tokens"]).toBe("7");
      expect(after.attributes["langwatch.thread.id"]).toBe("conv_g");
      expect(after.attributes["langwatch.input"]).toBe(
        '[{"role":"user","content":"Hi"}]',
      );
      expect(after.attributes["langwatch.output"]).toBe(
        '[{"role":"assistant","content":"Hello"}]',
      );
    });

    it("leaves langwatch.* untouched when zero gen_ai.* fields are present", () => {
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent({ "event.name": "noise" }, { scopeName: "gen_ai" }),
        state,
      );
      expect(after.attributes["langwatch.model"]).toBeUndefined();
      expect(after.attributes["langwatch.input_tokens"]).toBeUndefined();
    });
  });

  // Top-level column mirror — the v2 drawer header chips + /traces list read
  // trace.models / trace.totalPromptTokenCount / trace.totalCompletionTokenCount
  // directly. For Path B log-only emitters that stay on the log path (codex,
  // gemini) the mirror lifts those columns off the canonical log attrs.
  describe("top-level column mirror from log lifts", () => {
    const codexTurn = (
      model: string,
      inTok: string,
      outTok: string,
    ): LogRecordReceivedEvent =>
      makeLogEvent(
        {
          "event.name": "codex.sse_event",
          model,
          input_token_count: inTok,
          output_token_count: outTok,
          "conversation.id": "conv_mirror",
        },
        { scopeName: "codex_exec", body: "codex.sse_event" },
      );

    it("mirrors langwatch.model onto state.models (deduped union)", () => {
      const projection = makeProjection();
      const after = projection.handleTraceLogRecordReceived(
        codexTurn("gpt-5.5", "1542", "318"),
        createInitState(),
      );
      expect(after.models).toEqual(["gpt-5.5"]);
    });

    it("mirrors token counts onto the top-level columns", () => {
      const projection = makeProjection();
      const after = projection.handleTraceLogRecordReceived(
        codexTurn("gpt-5.5", "1542", "318"),
        createInitState(),
      );
      expect(after.totalPromptTokenCount).toBe(1542);
      expect(after.totalCompletionTokenCount).toBe(318);
    });

    it("accumulates tokens across multi-turn events; models stay deduped", () => {
      const projection = makeProjection();
      let state = createInitState();
      state = projection.handleTraceLogRecordReceived(
        codexTurn("gpt-5.5", "100", "50"),
        state,
      );
      state = projection.handleTraceLogRecordReceived(
        codexTurn("gpt-5.5", "200", "70"),
        state,
      );
      expect(state.totalPromptTokenCount).toBe(300);
      expect(state.totalCompletionTokenCount).toBe(120);
      expect(state.models).toEqual(["gpt-5.5"]);
    });

    it("unions multiple distinct models across turns", () => {
      const projection = makeProjection();
      let state = createInitState();
      state = projection.handleTraceLogRecordReceived(
        codexTurn("gpt-5-mini", "10", "5"),
        state,
      );
      state = projection.handleTraceLogRecordReceived(
        codexTurn("gpt-5.5", "100", "50"),
        state,
      );
      expect(state.models).toEqual(["gpt-5-mini", "gpt-5.5"]);
    });

    it("leaves top-level columns untouched when no canonical lift fires", () => {
      const projection = makeProjection();
      const state = createInitState();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent(
          { "event.name": "user_prompt", "session.id": "s", prompt: "Hi" },
          { body: "claude_code.user_prompt" },
        ),
        state,
      );
      expect(after.models).toEqual(state.models);
      expect(after.totalCost).toBe(state.totalCost);
      expect(after.totalPromptTokenCount).toBe(state.totalPromptTokenCount);
      expect(after.totalCompletionTokenCount).toBe(
        state.totalCompletionTokenCount,
      );
    });
  });
});
