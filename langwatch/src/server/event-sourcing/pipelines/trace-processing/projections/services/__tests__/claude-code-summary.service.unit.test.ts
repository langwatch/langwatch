/**
 * Claude-specific facts about an interaction — the ones you cannot reconstruct
 * from a prompt-and-reply pair, and which Claude splits across signals (the
 * stop_reason rides a span; the slash command and the compaction ride logs).
 */
import { describe, expect, it } from "vitest";
import type { LogRecordReceivedEventData } from "../../../schemas/events";
import type { NormalizedSpan } from "../../../schemas/spans";
import {
  accumulateClaudeSummaryFromLog,
  accumulateClaudeSummaryFromSpan,
  CLAUDE_ATTRS,
} from "../claude-code-summary.service";

function span(name: string, spanAttributes: Record<string, string> = {}) {
  return { name, spanAttributes } as unknown as NormalizedSpan;
}

function logData(attributes: Record<string, string>) {
  return { attributes } as unknown as LogRecordReceivedEventData;
}

/** Fold spans then logs, the way the projection does. */
function foldAll({
  spans = [],
  logs = [],
}: {
  spans?: NormalizedSpan[];
  logs?: LogRecordReceivedEventData[];
}): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const s of spans) {
    Object.assign(
      attributes,
      accumulateClaudeSummaryFromSpan({ attributes, span: s }),
    );
  }
  for (const data of logs) {
    Object.assign(
      attributes,
      accumulateClaudeSummaryFromLog({ attributes, data }),
    );
  }
  return attributes;
}

describe("Claude Code trace facts", () => {
  describe("given an agentic loop that finished normally", () => {
    // The earlier calls all stop on `tool_use` by definition — that is what
    // drove the loop onward. Only the LAST one says how the interaction ended.
    it("reports the FINAL call's stop reason, not the loop's", () => {
      const attributes = foldAll({
        spans: [
          span("claude_code.llm_request", { stop_reason: "tool_use" }),
          span("claude_code.llm_request", { stop_reason: "tool_use" }),
          span("claude_code.llm_request", { stop_reason: "end_turn" }),
        ],
      });

      expect(attributes[CLAUDE_ATTRS.STOP_REASON]).toBe("end_turn");
      expect(attributes[CLAUDE_ATTRS.TRUNCATED]).toBe("false");
    });
  });

  describe("given a reply that was cut off by max_tokens", () => {
    // This is the load-bearing one: rendered as the trace's "output" a truncated
    // reply reads as though the agent finished. Nothing else says otherwise.
    it("marks the interaction truncated, so the output is not mistaken for an answer", () => {
      const attributes = foldAll({
        spans: [span("claude_code.llm_request", { stop_reason: "max_tokens" })],
      });

      expect(attributes[CLAUDE_ATTRS.TRUNCATED]).toBe("true");
    });

    it("marks a refusal the same way", () => {
      const attributes = foldAll({
        spans: [span("claude_code.llm_request", { stop_reason: "refusal" })],
      });

      expect(attributes[CLAUDE_ATTRS.TRUNCATED]).toBe("true");
    });
  });

  describe("given an interaction opened by a slash command with skills and sub-agents", () => {
    const attributes = foldAll({
      spans: [
        span("claude_code.interaction", { "interaction.sequence": "3" }),
        span("claude_code.tool", { subagent_type: "Explore" }),
        span("claude_code.tool", { subagent_type: "Explore" }),
        span("claude_code.tool", { subagent_type: "general-purpose" }),
      ],
      logs: [
        logData({ "event.name": "user_prompt", command_name: "review" }),
        logData({ "event.name": "skill_activated", "skill.name": "code-review" }),
      ],
    });

    it("records the slash command that was the real intent", () => {
      expect(attributes[CLAUDE_ATTRS.SLASH_COMMAND]).toBe("review");
    });

    it("collects skills from the Skill tool span as well as the log event", () => {
      // A skill Claude invoked proactively arrives on the tool span; a `/slash`
      // skill arrives on the log event. Reading one path loses half of them.
      const merged = foldAll({
        spans: [span("claude_code.tool", { skill_name: "deep-research" })],
        logs: [
          logData({ "event.name": "skill_activated", "skill.name": "code-review" }),
        ],
      });

      expect(JSON.parse(merged[CLAUDE_ATTRS.SKILLS] ?? "[]")).toEqual([
        "deep-research",
        "code-review",
      ]);
    });

    it("records WHICH agents and skills ran, without duplicates", () => {
      expect(JSON.parse(attributes[CLAUDE_ATTRS.SUBAGENT_TYPES] ?? "[]")).toEqual([
        "Explore",
        "general-purpose",
      ]);
      expect(JSON.parse(attributes[CLAUDE_ATTRS.SKILLS] ?? "[]")).toEqual([
        "code-review",
      ]);
    });

    it("records which interaction of the session this was", () => {
      expect(attributes[CLAUDE_ATTRS.SEQUENCE]).toBe("3");
    });
  });

  describe("given a compaction and failed model calls", () => {
    // A compacted interaction answered from a summary, not the real history —
    // the usual answer to "why did it forget?". A failed call has no successful
    // span, so it exists only here.
    it("records both, since neither has a span", () => {
      const attributes = foldAll({
        logs: [
          logData({ "event.name": "compaction", trigger: "auto" }),
          logData({ "event.name": "api_error", status_code: "529" }),
          logData({ "event.name": "api_error", status_code: "529" }),
          logData({ "event.name": "permission_mode_changed", to_mode: "plan" }),
        ],
      });

      expect(attributes[CLAUDE_ATTRS.COMPACTED]).toBe("true");
      expect(attributes[CLAUDE_ATTRS.API_ERRORS]).toBe("2");
      expect(attributes[CLAUDE_ATTRS.PERMISSION_MODE]).toBe("plan");
    });
  });

  describe("given a non-Claude span", () => {
    it("derives nothing", () => {
      expect(
        accumulateClaudeSummaryFromSpan({
          attributes: {},
          span: span("openai.chat", { stop_reason: "stop" }),
        }),
      ).toEqual({});
    });
  });
});
