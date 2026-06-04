/**
 * Fold-projection regression tests for the claude_code.api_request
 * cost/tokens/model lift in handleTraceLogRecordReceived.
 *
 * Verifies the fold writes the canonical langwatch.* attributes
 * onto the trace_summary state when a Claude Code api_request log
 * lands with synthesized trace context. Without this lift, the
 * trace UI shows blank cost/tokens/model even when the underlying
 * log records carry them.
 *
 * Includes the cache_read vs cache_creation distinct-value
 * regression — silently swapping those would misreport customer
 * cost by ~12× in either direction.
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

function makeClaudeApiRequestEvent(
  attrs: Record<string, string>,
): LogRecordReceivedEvent {
  return {
    id: `evt-claude-api`,
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
      body: "claude_code.api_request",
      attributes: {
        "event.name": "api_request",
        ...attrs,
      },
      resourceAttributes: { "service.name": "claude-code" },
      scopeName: "com.anthropic.claude_code.events",
      scopeVersion: "2.1.162",
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

describe("TraceSummaryFoldProjection — claude_code api_request lift", () => {
  describe("when an api_request log carries cost, tokens, and model", () => {
    it("lifts model + cost_usd + tokens onto langwatch.* canonical attributes", () => {
      const projection = makeProjection();
      const state = createInitState();

      const after = projection.handleTraceLogRecordReceived(
        makeClaudeApiRequestEvent({
          "session.id": "sess_42",
          model: "claude-haiku-4-5-20251001",
          cost_usd: "0.001234",
          input_tokens: "462",
          output_tokens: "39",
          cache_read_tokens: "5",
          cache_creation_tokens: "17",
        }),
        state,
      );

      expect(after.attributes["langwatch.model"]).toBe(
        "claude-haiku-4-5-20251001",
      );
      expect(after.attributes["langwatch.cost.usd"]).toBe("0.001234");
      expect(after.attributes["langwatch.input_tokens"]).toBe("462");
      expect(after.attributes["langwatch.output_tokens"]).toBe("39");
      expect(after.attributes["langwatch.thread.id"]).toBe("sess_42");
    });

    /**
     * REGRESSION GUARD — anthropic's cache pricing tiers:
     *   cache_creation ~1.25× regular input (writing)
     *   cache_read     ~0.10× regular input (reading)
     * A field-swap would silently mis-bill by ~12× in either
     * direction. Distinct numeric values + by-name assertions
     * make any flip visible at the test layer.
     */
    it("keeps cache_read distinct from cache_creation (no swap)", () => {
      const projection = makeProjection();
      const state = createInitState();

      const after = projection.handleTraceLogRecordReceived(
        makeClaudeApiRequestEvent({
          "session.id": "s",
          model: "claude-opus-4-7",
          cache_read_tokens: "1000",
          cache_creation_tokens: "2000",
        }),
        state,
      );
      expect(after.attributes["langwatch.cache_read_tokens"]).toBe("1000");
      expect(after.attributes["langwatch.cache_creation_tokens"]).toBe("2000");
      expect(after.attributes["langwatch.cache_read_tokens"]).not.toBe(
        after.attributes["langwatch.cache_creation_tokens"],
      );
    });

    it("does NOT touch langwatch.* keys when the record is user_prompt", () => {
      const projection = makeProjection();
      const state = createInitState();
      const ev = makeClaudeApiRequestEvent({
        "session.id": "s",
        prompt: "What is 2+2?",
      });
      ev.data.attributes["event.name"] = "user_prompt";
      ev.data.body = "claude_code.user_prompt";

      const after = projection.handleTraceLogRecordReceived(ev, state);
      expect(after.attributes["langwatch.cost.usd"]).toBeUndefined();
      expect(after.attributes["langwatch.input_tokens"]).toBeUndefined();
      expect(after.attributes["langwatch.model"]).toBeUndefined();
    });
  });

  describe("when api_request comes from a non-claude scope", () => {
    it("does NOT misfire on codex.api_request even with same event.name", () => {
      const projection = makeProjection();
      const state = createInitState();
      const ev = makeClaudeApiRequestEvent({
        "session.id": "s",
        model: "gpt-5",
        cost_usd: "0.5",
      });
      ev.data.scopeName = "com.openai.codex.events";

      const after = projection.handleTraceLogRecordReceived(ev, state);
      expect(after.attributes["langwatch.cost.usd"]).toBeUndefined();
      expect(after.attributes["langwatch.model"]).toBeUndefined();
    });
  });

  describe("codex.sse_event lift", () => {
    /**
     * Codex emits cost-bearing turns as codex.sse_event with model +
     * token counts + conversation.id + user.email. No cost field on
     * the wire — downstream model-pricing fills langwatch.cost.usd
     * from (model, tokens).
     */
    it("lifts model + token counts + thread.id + principal", () => {
      const projection = makeProjection();
      const state = createInitState();
      const ev = makeClaudeApiRequestEvent({});
      ev.data.scopeName = "codex_exec";
      ev.data.body = "codex.sse_event";
      ev.data.attributes = {
        "event.name": "codex.sse_event",
        model: "gpt-5.5",
        input_token_count: "9700",
        output_token_count: "47",
        cached_token_count: "1200",
        "conversation.id": "conv_abc",
        "user.email": "rogerio@langwatch.ai",
      };

      const after = projection.handleTraceLogRecordReceived(ev, state);
      expect(after.attributes["langwatch.model"]).toBe("gpt-5.5");
      expect(after.attributes["langwatch.input_tokens"]).toBe("9700");
      expect(after.attributes["langwatch.output_tokens"]).toBe("47");
      expect(after.attributes["langwatch.cache_read_tokens"]).toBe("1200");
      expect(after.attributes["langwatch.thread.id"]).toBe("conv_abc");
      expect(after.attributes["langwatch.principal.email"]).toBe(
        "rogerio@langwatch.ai",
      );
    });

    /**
     * Codex doesn't emit `cache_creation_tokens` on the wire (anthropic
     * concept). Lift must leave that langwatch.* key untouched so the
     * trace UI doesn't show a spurious zero.
     */
    it("does NOT set langwatch.cache_creation_tokens for codex (codex doesn't emit it)", () => {
      const projection = makeProjection();
      const state = createInitState();
      const ev = makeClaudeApiRequestEvent({});
      ev.data.body = "codex.sse_event";
      ev.data.attributes = {
        "event.name": "codex.sse_event",
        model: "gpt-5.5",
        input_token_count: "100",
        output_token_count: "20",
      };

      const after = projection.handleTraceLogRecordReceived(ev, state);
      expect(after.attributes["langwatch.cache_creation_tokens"]).toBeUndefined();
    });
  });

  describe("codex.conversation_starts lift", () => {
    it("lifts model + principal even before the first sse_event arrives", () => {
      const projection = makeProjection();
      const state = createInitState();
      const ev = makeClaudeApiRequestEvent({});
      ev.data.body = "codex.conversation_starts";
      ev.data.attributes = {
        "event.name": "codex.conversation_starts",
        model: "gpt-5.5",
        "user.email": "rogerio@langwatch.ai",
        "conversation.id": "conv_x",
      };

      const after = projection.handleTraceLogRecordReceived(ev, state);
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
      const ev = makeClaudeApiRequestEvent({});
      ev.data.scopeName = "gen_ai";
      ev.data.body = "gen_ai.event";
      ev.data.attributes = {
        "gen_ai.request.model": "gemini-2.0-flash",
        "gen_ai.usage.input_tokens": "150",
        "gen_ai.usage.output_tokens": "30",
        "gen_ai.conversation.id": "conv_g",
        "gen_ai.input.messages":
          '[{"role":"user","content":"Hi"}]',
        "gen_ai.output.messages":
          '[{"role":"assistant","content":"Hello"}]',
        cached_content_token_count: "7",
      };

      const after = projection.handleTraceLogRecordReceived(ev, state);
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
      const ev = makeClaudeApiRequestEvent({});
      ev.data.scopeName = "gen_ai";
      ev.data.attributes = { "event.name": "noise" };

      const after = projection.handleTraceLogRecordReceived(ev, state);
      expect(after.attributes["langwatch.model"]).toBeUndefined();
      expect(after.attributes["langwatch.input_tokens"]).toBeUndefined();
    });
  });
});
