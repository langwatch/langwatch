/**
 * Unit tests for the claude-code log -> span synthesizer.
 *
 * The wire shape under test was captured empirically from
 * @anthropic-ai/claude-code 2.1.162 with
 *   CLAUDE_CODE_ENABLE_TELEMETRY=1
 *   OTEL_LOGS_EXPORTER=otlp
 *   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 *   OTEL_LOG_USER_PROMPTS=1
 * against a local OTLP catcher. Verified with `strings cli.js` that
 * claude code 2.1.x has NO trace exporter code path at all — these
 * synthesized spans are the only way claude_code interactions show
 * up under /me/traces.
 */
import { describe, expect, it } from "vitest";

import {
  CLAUDE_CODE_EVENT_SCOPE,
  synthesizeClaudeCodeSpans,
  type ClaudeCodeLogRecordView,
} from "../claude-code-log-to-span.synthesizer";

function userPromptRecord(opts: {
  sessionId: string;
  promptId: string;
  prompt: string;
  timeUnixNano?: number;
}): ClaudeCodeLogRecordView {
  return {
    scopeName: CLAUDE_CODE_EVENT_SCOPE,
    attrs: {
      "event.name": "user_prompt",
      "session.id": opts.sessionId,
      "prompt.id": opts.promptId,
      prompt: opts.prompt,
      prompt_length: String(opts.prompt.length),
    },
    resourceAttrs: { "service.name": "claude-code" },
    timeUnixNano: opts.timeUnixNano ?? 1_780_000_000_000_000_000,
  };
}

function apiRequestRecord(opts: {
  sessionId: string;
  promptId: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
  timeUnixNano?: number;
}): ClaudeCodeLogRecordView {
  return {
    scopeName: CLAUDE_CODE_EVENT_SCOPE,
    attrs: {
      "event.name": "api_request",
      "session.id": opts.sessionId,
      "prompt.id": opts.promptId,
      model: opts.model ?? "claude-opus-4-7",
      input_tokens: String(opts.inputTokens ?? 100),
      output_tokens: String(opts.outputTokens ?? 200),
      cache_read_tokens: "0",
      cache_creation_tokens: "0",
      cost_usd: String(opts.costUsd ?? 0.05),
      duration_ms: String(opts.durationMs ?? 1500),
      request_id: "req_abc",
    },
    resourceAttrs: { "service.name": "claude-code" },
    timeUnixNano: opts.timeUnixNano ?? 1_780_000_000_000_000_000,
  };
}

function attr(span: { attributes: any[] }, key: string): any {
  return span.attributes.find((a) => a.key === key)?.value;
}

describe("synthesizeClaudeCodeSpans", () => {
  describe("when a user_prompt + api_request pair share a prompt.id", () => {
    it("emits exactly one span and pairs the input with the api metadata", () => {
      const spans = synthesizeClaudeCodeSpans([
        userPromptRecord({
          sessionId: "sess_1",
          promptId: "p_1",
          prompt: "What is 2+2?",
        }),
        apiRequestRecord({
          sessionId: "sess_1",
          promptId: "p_1",
          model: "claude-opus-4-7",
          inputTokens: 13,
          outputTokens: 27,
          costUsd: 0.001234,
          durationMs: 2000,
        }),
      ]);

      expect(spans).toHaveLength(1);
      const s = spans[0]!;
      expect(s.name).toBe("claude_code.api_request");
      expect(attr(s, "gen_ai.system").stringValue).toBe("anthropic");
      expect(attr(s, "gen_ai.request.model").stringValue).toBe("claude-opus-4-7");
      expect(attr(s, "gen_ai.usage.input_tokens").intValue).toBe("13");
      expect(attr(s, "gen_ai.usage.output_tokens").intValue).toBe("27");
      expect(attr(s, "gen_ai.conversation.id").stringValue).toBe("sess_1");
      expect(attr(s, "langwatch.span.type").stringValue).toBe("llm");
      expect(attr(s, "langwatch.cost.usd").doubleValue).toBeCloseTo(0.001234, 6);
      const inputJson = JSON.parse(attr(s, "langwatch.input.value").stringValue);
      expect(inputJson).toEqual([{ role: "user", content: "What is 2+2?" }]);
    });
  });

  describe("when only an api_request is present (no matched user_prompt)", () => {
    it("still emits a span so the call shows up, with empty input messages", () => {
      const spans = synthesizeClaudeCodeSpans([
        apiRequestRecord({ sessionId: "sess_orphan", promptId: "p_2" }),
      ]);
      expect(spans).toHaveLength(1);
      const s = spans[0]!;
      expect(attr(s, "langwatch.input.value").stringValue).toBe("[]");
      expect(attr(s, "gen_ai.request.model").stringValue).toBe("claude-opus-4-7");
    });
  });

  describe("when a user_prompt has no matching api_request", () => {
    it("emits no span (user prompts alone are not billable spans)", () => {
      const spans = synthesizeClaudeCodeSpans([
        userPromptRecord({
          sessionId: "sess_dead",
          promptId: "p_dead",
          prompt: "abandoned",
        }),
      ]);
      expect(spans).toHaveLength(0);
    });
  });

  describe("trace_id derivation", () => {
    /**
     * Multi-turn conversations under one claude session must group
     * into ONE trace in /me/traces. trace_id derives from session.id
     * alone so every api_request within the session shares it.
     */
    it("returns the same trace_id for every api_request of a session", () => {
      const spans = synthesizeClaudeCodeSpans([
        userPromptRecord({ sessionId: "s", promptId: "p_a", prompt: "1" }),
        apiRequestRecord({ sessionId: "s", promptId: "p_a" }),
        userPromptRecord({ sessionId: "s", promptId: "p_b", prompt: "2" }),
        apiRequestRecord({ sessionId: "s", promptId: "p_b" }),
      ]);
      expect(spans).toHaveLength(2);
      expect(spans[0]!.traceId).toBe(spans[1]!.traceId);
      expect(spans[0]!.spanId).not.toBe(spans[1]!.spanId);
    });

    it("returns DIFFERENT trace_ids across different sessions", () => {
      const spans = synthesizeClaudeCodeSpans([
        apiRequestRecord({ sessionId: "s1", promptId: "p" }),
        apiRequestRecord({ sessionId: "s2", promptId: "p" }),
      ]);
      expect(spans[0]!.traceId).not.toBe(spans[1]!.traceId);
    });
  });

  describe("idempotency through stored_spans ReplacingMergeTree", () => {
    /**
     * Re-ingesting the same OTLP batch (network retry, receiver
     * restart) must produce the same span_id so ReplacingMergeTree
     * dedups instead of double-counting tokens.
     */
    it("derives the same span_id for the same (session.id, prompt.id) on re-run", () => {
      const a = synthesizeClaudeCodeSpans([
        userPromptRecord({ sessionId: "s", promptId: "p", prompt: "x" }),
        apiRequestRecord({ sessionId: "s", promptId: "p" }),
      ])[0]!;
      const b = synthesizeClaudeCodeSpans([
        userPromptRecord({ sessionId: "s", promptId: "p", prompt: "x" }),
        apiRequestRecord({ sessionId: "s", promptId: "p" }),
      ])[0]!;
      expect(a.spanId).toBe(b.spanId);
      expect(a.traceId).toBe(b.traceId);
    });
  });

  describe("ignored event types", () => {
    it("does NOT emit spans for hook_*, plugin_loaded, tool_decision noise", () => {
      const noise: ClaudeCodeLogRecordView = {
        scopeName: CLAUDE_CODE_EVENT_SCOPE,
        attrs: {
          "event.name": "hook_execution_start",
          "session.id": "s",
          "prompt.id": "p",
        },
        resourceAttrs: {},
        timeUnixNano: 0,
      };
      expect(synthesizeClaudeCodeSpans([noise])).toHaveLength(0);
    });

    it("ignores records from other scopes (codex, gemini, generic otel)", () => {
      const codexLike: ClaudeCodeLogRecordView = {
        scopeName: "com.openai.codex.events",
        attrs: {
          "event.name": "api_request",
          "session.id": "s",
          "prompt.id": "p",
        },
        resourceAttrs: {},
        timeUnixNano: 0,
      };
      expect(synthesizeClaudeCodeSpans([codexLike])).toHaveLength(0);
    });
  });

  describe("time window derivation", () => {
    it("uses api_request.timeUnixNano as end and subtracts duration_ms for start", () => {
      const endNs = 1_780_000_000_000_000_000;
      const durationMs = 1500;
      const spans = synthesizeClaudeCodeSpans([
        apiRequestRecord({
          sessionId: "s",
          promptId: "p",
          timeUnixNano: endNs,
          durationMs,
        }),
      ]);
      expect(spans[0]!.endTimeUnixNano).toBe(String(endNs));
      const start = BigInt(spans[0]!.startTimeUnixNano);
      const end = BigInt(spans[0]!.endTimeUnixNano);
      expect(end - start).toBe(BigInt(durationMs) * 1_000_000n);
    });
  });
});
