/**
 * Unit tests for extractGenAiLogMetrics — the defensive log-level
 * lift of gen_ai.* canonical attributes onto langwatch.*.
 *
 * Mirrors GEMINI_OTTL_STARTER but runs natively in TS so /me/traces
 * shows gemini CLI 0.32+ telemetry (and any other gen_ai-canonical
 * emitter) without rounding through the gateway. Gated on field
 * PRESENCE, not event.name, so a custom OTel exporter that emits
 * gen_ai.* on logs also benefits.
 */
import { describe, expect, it } from "vitest";

import type { LogRecordReceivedEventData } from "../../../schemas/events";
import { extractGenAiLogMetrics } from "../trace-io-accumulation.service";

function genAiEvent(
  attrs: Record<string, string>,
  scope = "gen_ai",
): LogRecordReceivedEventData {
  return {
    traceId: "t1",
    spanId: "s1",
    timeUnixMs: 1700000000000,
    severityNumber: 9,
    severityText: "INFO",
    body: "gen_ai.event",
    attributes: attrs,
    resourceAttributes: { "service.name": "gemini-cli" },
    scopeName: scope,
    scopeVersion: "0.32",
    piiRedactionLevel: "ESSENTIAL",
  };
}

describe("extractGenAiLogMetrics", () => {
  it("lifts every gen_ai.* canonical field a gemini log carries", () => {
    const out = extractGenAiLogMetrics(
      genAiEvent({
        "gen_ai.request.model": "gemini-2.0-flash",
        "gen_ai.usage.input_tokens": "150",
        "gen_ai.usage.output_tokens": "30",
        "gen_ai.conversation.id": "conv_xyz",
        "gen_ai.input.messages":
          '[{"role":"user","content":"What is 2+2?"}]',
        "gen_ai.output.messages": '[{"role":"assistant","content":"4"}]',
        cached_content_token_count: "7",
      }),
    );
    expect(out).toEqual({
      model: "gemini-2.0-flash",
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 7,
      threadId: "conv_xyz",
      inputMessages: '[{"role":"user","content":"What is 2+2?"}]',
      outputMessages: '[{"role":"assistant","content":"4"}]',
    });
  });

  it("returns null when zero gen_ai.* attributes are present", () => {
    const out = extractGenAiLogMetrics(
      genAiEvent({
        "event.name": "noise",
        unrelated: "value",
      }),
    );
    expect(out).toBeNull();
  });

  it("returns a partial result when only some fields are present", () => {
    const out = extractGenAiLogMetrics(
      genAiEvent({
        "gen_ai.request.model": "gemini-2.0-pro",
      }),
    );
    expect(out?.model).toBe("gemini-2.0-pro");
    expect(out?.inputTokens).toBeNull();
    expect(out?.outputMessages).toBeNull();
  });

  /**
   * cache_read alias resolution: gen_ai.usage.cache_read_tokens
   * (OTel semconv) and cached_content_token_count (vertex style)
   * are both valid emitters. Prefer the canonical key when present.
   */
  it("prefers gen_ai.usage.cache_read_tokens over cached_content_token_count", () => {
    const out = extractGenAiLogMetrics(
      genAiEvent({
        "gen_ai.request.model": "gemini-2.0-flash",
        "gen_ai.usage.cache_read_tokens": "100",
        cached_content_token_count: "999",
      }),
    );
    expect(out?.cacheReadTokens).toBe(100);
  });

  it("falls back to cached_content_token_count when canonical key absent", () => {
    const out = extractGenAiLogMetrics(
      genAiEvent({
        "gen_ai.request.model": "gemini-2.0-flash",
        cached_content_token_count: "42",
      }),
    );
    expect(out?.cacheReadTokens).toBe(42);
  });

  it("does not gate on a specific scope name (works for custom emitters)", () => {
    const out = extractGenAiLogMetrics(
      genAiEvent(
        { "gen_ai.request.model": "custom-model" },
        "com.example.custom_genai",
      ),
    );
    expect(out?.model).toBe("custom-model");
  });
});
