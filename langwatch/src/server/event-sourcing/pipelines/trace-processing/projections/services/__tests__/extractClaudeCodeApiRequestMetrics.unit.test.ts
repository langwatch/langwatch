/**
 * Unit tests for extractClaudeCodeApiRequestMetrics.
 *
 * Captures the empirical wire shape Claude Code 2.1.x emits per
 * billable model call as a com.anthropic.claude_code.events
 * LogRecord (event.name="api_request"). The lift is what makes
 * /me/traces show cost + tokens + model on a Path B claude trace
 * once the trace_id+span_id synthesizer at the receiver has
 * grouped them under the right session.
 *
 * Cache token regression test is REQUIRED: anthropic semantics
 * distinguish cache_creation_tokens (tokens WRITTEN to the
 * prompt cache, billed ≥ 1.25× regular input) from
 * cache_read_tokens (tokens READ from the cache, ~0.1× regular
 * input). Swapping the two would silently misreport customer
 * cost, so the regression test asserts each field independently
 * by name → value with distinct numeric values that make any
 * accidental swap visible.
 */
import { describe, expect, it } from "vitest";

import type { LogRecordReceivedEventData } from "../../../schemas/events";
import { extractClaudeCodeApiRequestMetrics } from "../trace-io-accumulation.service";

function claudeCodeEvent(
  attrs: Record<string, string>,
  scope = "com.anthropic.claude_code.events",
): LogRecordReceivedEventData {
  return {
    traceId: "t1",
    spanId: "s1",
    timeUnixMs: 1700000000000,
    severityNumber: 9,
    severityText: "INFO",
    body: "claude_code.api_request",
    attributes: attrs,
    resourceAttributes: { "service.name": "claude-code" },
    scopeName: scope,
    scopeVersion: "2.1.162",
    piiRedactionLevel: "ESSENTIAL",
  };
}

describe("extractClaudeCodeApiRequestMetrics", () => {
  describe("when the record is a claude_code.api_request", () => {
    it("lifts cost, model, and all four token fields", () => {
      const out = extractClaudeCodeApiRequestMetrics(
        claudeCodeEvent({
          "event.name": "api_request",
          model: "claude-haiku-4-5-20251001",
          cost_usd: "0.0010",
          input_tokens: "462",
          output_tokens: "39",
          cache_read_tokens: "5",
          cache_creation_tokens: "17",
        }),
      );
      expect(out).toEqual({
        model: "claude-haiku-4-5-20251001",
        costUsd: 0.001,
        inputTokens: 462,
        outputTokens: 39,
        cacheReadTokens: 5,
        cacheCreationTokens: 17,
      });
    });

    /**
     * Regression guard: cache_read vs cache_creation must NOT
     * swap. Distinct numeric values make any accidental flip
     * visible at the assertion level — toEqual won't accept
     * silently reordered semantics. Anthropic pricing: cache
     * creation tokens are billed ≥ 1.25× regular input; cache
     * read tokens are billed ~0.1× regular input. A swap would
     * cause silent ~12× misreporting in either direction.
     */
    it("keeps cache_read distinct from cache_creation (no swap)", () => {
      const out = extractClaudeCodeApiRequestMetrics(
        claudeCodeEvent({
          "event.name": "api_request",
          model: "claude-opus-4-7",
          cache_read_tokens: "1000",
          cache_creation_tokens: "2000",
        }),
      );
      expect(out?.cacheReadTokens).toBe(1000);
      expect(out?.cacheCreationTokens).toBe(2000);
      expect(out?.cacheReadTokens).not.toBe(out?.cacheCreationTokens);
    });

    it("returns null fields when an attribute is missing or empty", () => {
      const out = extractClaudeCodeApiRequestMetrics(
        claudeCodeEvent({
          "event.name": "api_request",
          model: "claude-opus-4-7",
          input_tokens: "0",
          output_tokens: "",
        }),
      );
      expect(out?.model).toBe("claude-opus-4-7");
      expect(out?.inputTokens).toBe(0);
      expect(out?.outputTokens).toBeNull();
      expect(out?.costUsd).toBeNull();
      expect(out?.cacheReadTokens).toBeNull();
      expect(out?.cacheCreationTokens).toBeNull();
    });
  });

  describe("when the record is NOT api_request", () => {
    it("returns null for user_prompt events (input lifted elsewhere)", () => {
      const out = extractClaudeCodeApiRequestMetrics(
        claudeCodeEvent({
          "event.name": "user_prompt",
          prompt: "What is 2+2?",
        }),
      );
      expect(out).toBeNull();
    });

    it("returns null for noise events (hook_registered, plugin_loaded, tool_decision, …)", () => {
      for (const en of [
        "hook_registered",
        "hook_execution_start",
        "plugin_loaded",
        "tool_decision",
        "mcp_server_connection",
      ]) {
        const out = extractClaudeCodeApiRequestMetrics(
          claudeCodeEvent({ "event.name": en }),
        );
        expect(out).toBeNull();
      }
    });
  });

  describe("when the record is not from claude_code scope", () => {
    it("returns null even if event.name happens to be api_request", () => {
      const out = extractClaudeCodeApiRequestMetrics(
        claudeCodeEvent(
          {
            "event.name": "api_request",
            model: "gpt-5",
            cost_usd: "0.5",
          },
          "com.openai.codex.events",
        ),
      );
      expect(out).toBeNull();
    });
  });
});
