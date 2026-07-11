import { describe, expect, it } from "vitest";
import type { TraceLogRecordDto } from "~/server/api/routers/tracesV2";
import { deriveSessionEvents } from "../sessionEvents";

/**
 * A trace is spans AND logs, and they complement each other. A whole class of
 * things never produces a span — most importantly a tool the user DENIED, which
 * never ran and therefore has no span and no result. Reading only the spans
 * leaves those moments invisible.
 */
function log(
  attributes: Record<string, string>,
  timeUnixMs = 1000,
): TraceLogRecordDto {
  return {
    spanId: "s1",
    timeUnixMs,
    body: "",
    attributes,
    resourceAttributes: {},
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  } as unknown as TraceLogRecordDto;
}

describe("deriveSessionEvents", () => {
  describe("given a tool the user denied", () => {
    it("keys the rejection by tool_use_id so it lands on the exact call", () => {
      const { rejectionsByToolUseId } = deriveSessionEvents([
        log({
          "event.name": "tool_decision",
          decision: "reject",
          tool_use_id: "toolu_1",
          tool_name: "Bash",
          source: "user_reject",
        }),
      ]);

      expect(rejectionsByToolUseId.get("toolu_1")).toEqual({
        toolName: "Bash",
        source: "user_reject",
      });
    });
  });

  describe("given an ACCEPTED tool decision", () => {
    it("is ignored — the tool span that followed already evidences it", () => {
      const { rejectionsByToolUseId } = deriveSessionEvents([
        log({
          "event.name": "tool_decision",
          decision: "accept",
          tool_use_id: "toolu_2",
          tool_name: "Read",
        }),
      ]);

      expect(rejectionsByToolUseId.size).toBe(0);
    });
  });

  describe("given failures and a compaction", () => {
    const { notes } = deriveSessionEvents([
      log(
        {
          "event.name": "compaction",
          trigger: "auto",
          pre_tokens: "180000",
          post_tokens: "42000",
        },
        3000,
      ),
      log(
        { "event.name": "api_error", status_code: "529", error: "Overloaded" },
        1000,
      ),
      log({ "event.name": "api_retries_exhausted", total_attempts: "5" }, 2000),
    ]);

    it("surfaces them in the order they happened", () => {
      expect(notes.map((n) => n.kind)).toEqual([
        "error",
        "error",
        "compaction",
      ]);
    });

    it("reports the API error with its status", () => {
      expect(notes[0]?.text).toBe("529 — Overloaded");
    });

    it("reports the compaction with what it cost the context", () => {
      expect(notes[2]?.text).toContain("180k → 42k tokens");
    });
  });

  describe("given ordinary content logs", () => {
    it("derives nothing — they are already carried by the spans", () => {
      const events = deriveSessionEvents([
        log({ "event.name": "user_prompt", prompt: "hi" }),
        log({ "event.name": "api_request", cost_usd: "0.1" }),
      ]);

      expect(events.notes).toEqual([]);
      expect(events.rejectionsByToolUseId.size).toBe(0);
    });
  });
});
