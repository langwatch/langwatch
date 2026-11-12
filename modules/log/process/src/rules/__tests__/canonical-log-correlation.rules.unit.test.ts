/**
 * Correlation synthesis for logs that carry no trace id of their own.
 * @see specs/ai-governance/ingestion-sources/grok-cli-otlp.feature
 */
import { describe, expect, it } from "vitest";

import { synthesizeCorrelation } from "../canonical-log-correlation.rules.ts";

const GROK_SCOPE = "ai.xai.grok_code";
const SESSION = "01a196a8-0cb5-7c41-957b-3f0e5d2a9c10";

function grokTurnRecord(eventName: string, sequence: number) {
  return synthesizeCorrelation({
    scopeName: GROK_SCOPE,
    wireTraceId: "",
    wireSpanId: "",
    eventName,
    attributes: { "session.id": SESSION, "prompt.id": "p-1", "event.sequence": String(sequence) },
  });
}

describe("synthesizeCorrelation", () => {
  describe("given the records of one Grok turn with no trace id", () => {
    /** @scenario Every record of one Grok turn groups under one synthesized trace id */
    it("groups them under one trace id with a distinct span id each", () => {
      const turn = [
        grokTurnRecord("grok_code.user_prompt", 3),
        grokTurnRecord("grok_code.api_request", 5),
        grokTurnRecord("grok_code.tool_result", 14),
        grokTurnRecord("grok_code.assistant_response", 23),
      ];

      expect(new Set(turn.map((record) => record.traceId)).size).toBe(1);
      expect(turn[0]!.traceId).toMatch(/^[a-f0-9]{32}$/);
      expect(new Set(turn.map((record) => record.spanId)).size).toBe(4);
      expect(turn.every((record) => record.providerKind === "grok")).toBe(true);
      expect(turn.every((record) => record.source === "grok_synthesized")).toBe(true);
    });

    it("gives the next turn a trace id of its own", () => {
      const next = synthesizeCorrelation({
        scopeName: GROK_SCOPE,
        wireTraceId: "",
        wireSpanId: "",
        eventName: "grok_code.user_prompt",
        attributes: { "session.id": SESSION, "prompt.id": "p-2", "event.sequence": "30" },
      });

      expect(next.traceId).not.toBe(grokTurnRecord("grok_code.user_prompt", 3).traceId);
    });
  });

  describe("given a keyless Grok record", () => {
    /** @scenario A keyless Grok record is not given a trace of its own */
    it("synthesizes no trace id", () => {
      const ambient = synthesizeCorrelation({
        scopeName: GROK_SCOPE,
        wireTraceId: "",
        wireSpanId: "",
        eventName: "grok_code.mcp_server_connection",
        attributes: { "event.sequence": "0" },
      });

      expect(ambient).toEqual({ traceId: "", spanId: "", source: "none", providerKind: "grok" });
    });
  });

  describe("given a Claude Code record", () => {
    it("still reports Claude Code as the provider", () => {
      const claude = synthesizeCorrelation({
        scopeName: "com.anthropic.claude_code.events",
        wireTraceId: "",
        wireSpanId: "",
        eventName: "claude_code.api_request",
        attributes: { "session.id": SESSION, "prompt.id": "p-1" },
      });

      expect(claude.providerKind).toBe("claude_code");
      expect(claude.source).toBe("claude_synthesized");
    });
  });
});
