/**
 * Unit tests for the codex log-record extractors.
 *
 * Wire shape captured empirically against codex 0.131-0.134 with a
 * local OTLP catcher. Codex emits three event types per
 * cost-bearing conversation: codex.user_prompt (carries `prompt` +
 * `conversation.id`), codex.sse_event (carries model + token counts
 * + `conversation.id` + `user.email`), codex.conversation_starts
 * (model + user.email at conversation creation).
 *
 * Codex does NOT emit a cost field — downstream model-pricing
 * lookup fills langwatch.cost.usd from (model, tokens). The
 * extractors here only lift the fields codex actually puts on the
 * wire.
 *
 * Mirrors the shape of extractClaudeCodeApiRequestMetrics tests so
 * the regression discipline (distinct cache values, scope-name
 * isolation, non-matching event names → null) is identical.
 */
import { describe, expect, it } from "vitest";

import type { LogRecordReceivedEventData } from "../../../schemas/events";
import {
  extractCodexConversationStartMetrics,
  extractCodexSseEventMetrics,
  extractIOFromLogRecord,
} from "../trace-io-accumulation.service";

function codexEvent(
  attrs: Record<string, string>,
  scope = "codex_exec",
): LogRecordReceivedEventData {
  return {
    traceId: "t1",
    spanId: "s1",
    timeUnixMs: 1700000000000,
    severityNumber: 9,
    severityText: "INFO",
    body: "codex.event",
    attributes: attrs,
    resourceAttributes: { "service.name": "codex_exec" },
    scopeName: scope,
    scopeVersion: "0.134",
    piiRedactionLevel: "ESSENTIAL",
  };
}

describe("extractCodexSseEventMetrics", () => {
  it("lifts model + token counts + conversation + principal", () => {
    const out = extractCodexSseEventMetrics(
      codexEvent({
        "event.name": "codex.sse_event",
        model: "gpt-5.5",
        input_token_count: "9700",
        output_token_count: "47",
        cached_token_count: "1200",
        "conversation.id": "conv_abc",
        "user.email": "rogerio@langwatch.ai",
      }),
    );
    expect(out).toEqual({
      model: "gpt-5.5",
      inputTokens: 9700,
      outputTokens: 47,
      cacheReadTokens: 1200,
      threadId: "conv_abc",
      principalEmail: "rogerio@langwatch.ai",
    });
  });

  it("returns null for user_prompt + conversation_starts + noise", () => {
    for (const en of [
      "codex.user_prompt",
      "codex.conversation_starts",
      "codex.task_started",
      "api_request",
    ]) {
      expect(
        extractCodexSseEventMetrics(codexEvent({ "event.name": en })),
      ).toBeNull();
    }
  });
});

describe("extractCodexConversationStartMetrics", () => {
  it("lifts model + principal at conversation creation", () => {
    const out = extractCodexConversationStartMetrics(
      codexEvent({
        "event.name": "codex.conversation_starts",
        model: "gpt-5.5",
        "user.email": "rogerio@langwatch.ai",
        "conversation.id": "conv_x",
      }),
    );
    expect(out).toEqual({
      model: "gpt-5.5",
      principalEmail: "rogerio@langwatch.ai",
    });
  });

  it("returns null for sse_event + user_prompt + noise", () => {
    for (const en of ["codex.sse_event", "codex.user_prompt", "noise"]) {
      expect(
        extractCodexConversationStartMetrics(codexEvent({ "event.name": en })),
      ).toBeNull();
    }
  });
});

describe("extractIOFromLogRecord — codex.user_prompt", () => {
  it("returns the prompt text as input", () => {
    const out = extractIOFromLogRecord(
      codexEvent({
        "event.name": "codex.user_prompt",
        prompt: "What's 2+2?",
        "conversation.id": "conv_abc",
      }),
    );
    expect(out).toEqual({ input: "What's 2+2?", output: null });
  });

  it("does NOT lift input from codex.sse_event (no prompt field)", () => {
    const out = extractIOFromLogRecord(
      codexEvent({
        "event.name": "codex.sse_event",
        model: "gpt-5.5",
      }),
    );
    expect(out).toEqual({ input: null, output: null });
  });
});
