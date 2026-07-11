/**
 * What a coding-agent interaction actually DID, folded onto the trace — the
 * facts you cannot reconstruct from a prompt-and-reply pair, and which the agent
 * splits across signals (the stop_reason rides a span; the slash command and the
 * compaction ride logs).
 *
 * The attributes are agent-agnostic (`langwatch.code_agent.*`); Claude Code is
 * simply the first adapter that populates them, which is why the fixtures below
 * speak claude_code span names.
 */
import { describe, expect, it } from "vitest";
import type { LogRecordReceivedEventData } from "../../../schemas/events";
import type { NormalizedSpan } from "../../../schemas/spans";
import {
  accumulateCodeAgentSummaryFromLog,
  accumulateCodeAgentSummaryFromSpan,
  CODE_AGENT_ATTRS,
} from "../code-agent-summary.service";

function span(name: string, spanAttributes: Record<string, string> = {}) {
  return { name, spanAttributes } as unknown as NormalizedSpan;
}

function toolSpan(
  toolName: string,
  startTimeUnixMs: number,
  statusCode: string | null = null,
) {
  return {
    name: "claude_code.tool",
    spanAttributes: { tool_name: toolName },
    startTimeUnixMs,
    statusCode,
  } as unknown as NormalizedSpan;
}

function stepNames(attributes: Record<string, string>): string[] {
  return JSON.parse(attributes[CODE_AGENT_ATTRS.STEPS] ?? "[]").map(
    ([, name]: [number, string]) => name,
  );
}

function spanWithStatus(
  name: string,
  spanAttributes: Record<string, string>,
  statusCode: string,
) {
  return { name, spanAttributes, statusCode } as unknown as NormalizedSpan;
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
      accumulateCodeAgentSummaryFromSpan({ attributes, span: s }),
    );
  }
  for (const data of logs) {
    Object.assign(
      attributes,
      accumulateCodeAgentSummaryFromLog({ attributes, data }),
    );
  }
  return attributes;
}

describe("code-agent interaction summary", () => {
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

      expect(attributes[CODE_AGENT_ATTRS.STOP_REASON]).toBe("end_turn");
      expect(attributes[CODE_AGENT_ATTRS.TRUNCATED]).toBe("false");
    });
  });

  describe("given a reply that was cut off by max_tokens", () => {
    // This is the load-bearing one: rendered as the trace's "output" a truncated
    // reply reads as though the agent finished. Nothing else says otherwise.
    it("marks the interaction truncated, so the output is not mistaken for an answer", () => {
      const attributes = foldAll({
        spans: [span("claude_code.llm_request", { stop_reason: "max_tokens" })],
      });

      expect(attributes[CODE_AGENT_ATTRS.TRUNCATED]).toBe("true");
    });

    it("marks a refusal the same way", () => {
      const attributes = foldAll({
        spans: [span("claude_code.llm_request", { stop_reason: "refusal" })],
      });

      expect(attributes[CODE_AGENT_ATTRS.TRUNCATED]).toBe("true");
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
      expect(attributes[CODE_AGENT_ATTRS.SLASH_COMMAND]).toBe("review");
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

      expect(JSON.parse(merged[CODE_AGENT_ATTRS.SKILLS] ?? "[]")).toEqual([
        "deep-research",
        "code-review",
      ]);
    });

    it("records WHICH agents and skills ran, without duplicates", () => {
      expect(JSON.parse(attributes[CODE_AGENT_ATTRS.SUBAGENT_TYPES] ?? "[]")).toEqual([
        "Explore",
        "general-purpose",
      ]);
      expect(JSON.parse(attributes[CODE_AGENT_ATTRS.SKILLS] ?? "[]")).toEqual([
        "code-review",
      ]);
    });

    it("records which interaction of the session this was", () => {
      expect(attributes[CODE_AGENT_ATTRS.SEQUENCE]).toBe("3");
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

      expect(attributes[CODE_AGENT_ATTRS.COMPACTED]).toBe("true");
      expect(attributes[CODE_AGENT_ATTRS.API_ERRORS]).toBe("2");
      expect(attributes[CODE_AGENT_ATTRS.PERMISSION_MODE]).toBe("plan");
    });
  });

  describe("given a non-Claude span", () => {
    it("derives nothing", () => {
      expect(
        accumulateCodeAgentSummaryFromSpan({
          attributes: {},
          span: span("openai.chat", { stop_reason: "stop" }),
        }),
      ).toEqual({});
    });
  });
});

describe("the work an interaction did", () => {
  describe("given an interaction that read, edited and ran commands", () => {
    const attributes = foldAll({
      spans: [
        span("claude_code.llm_request", { stop_reason: "tool_use" }),
        span("claude_code.llm_request", { stop_reason: "end_turn" }),
        span("claude_code.tool", { tool_name: "Read", file_path: "a.ts" }),
        span("claude_code.tool", { tool_name: "Read", file_path: "b.ts" }),
        span("claude_code.tool", { tool_name: "Bash" }),
        span("claude_code.tool", { tool_name: "Edit", file_path: "a.ts" }),
        span("claude_code.subagent.spawn"),
      ],
    });

    it("counts the model calls in the loop", () => {
      expect(attributes[CODE_AGENT_ATTRS.MODEL_CALLS]).toBe("2");
    });

    it("counts the tool runs and which tools they were", () => {
      expect(attributes[CODE_AGENT_ATTRS.TOOL_CALLS]).toBe("4");
      expect(JSON.parse(attributes[CODE_AGENT_ATTRS.TOOLS] ?? "{}")).toEqual({
        Read: 2,
        Bash: 1,
        Edit: 1,
      });
    });

    it("records the distinct files it touched, without duplicates", () => {
      expect(
        JSON.parse(attributes[CODE_AGENT_ATTRS.FILES_TOUCHED] ?? "[]"),
      ).toEqual(["a.ts", "b.ts"]);
    });

    it("counts the sub-agents it spawned", () => {
      expect(attributes[CODE_AGENT_ATTRS.SUB_AGENTS]).toBe("1");
    });
  });

  describe("given a tool that failed", () => {
    it("counts it, so a broken interaction is visible without opening it", () => {
      const attributes = foldAll({
        spans: [
          spanWithStatus("claude_code.tool", { tool_name: "Bash" }, "error"),
          span("claude_code.tool", { tool_name: "Bash" }),
        ],
      });

      expect(attributes[CODE_AGENT_ATTRS.FAILED_TOOLS]).toBe("1");
      expect(attributes[CODE_AGENT_ATTRS.TOOL_CALLS]).toBe("2");
    });
  });
});

describe("the ORDER things happened", () => {
  describe("given tools that ran one after another", () => {
    it("keeps them in the order they happened, not just their counts", () => {
      const attributes = foldAll({
        spans: [
          toolSpan("Read", 1000),
          toolSpan("Read", 2000),
          toolSpan("Bash", 3000),
          toolSpan("Edit", 4000),
          toolSpan("Bash", 5000),
        ],
      });

      // Counts alone would say "Bash 2, Read 2, Edit 1" and lose the story:
      // it read the files, ran the tests, fixed one, and re-ran them.
      expect(stepNames(attributes)).toEqual([
        "Read",
        "Read",
        "Bash",
        "Edit",
        "Bash",
      ]);
    });
  });

  describe("given spans that ARRIVE out of order", () => {
    // The fold sees spans in arrival order, which is not start order: spans are
    // exported in batches, so a slow tool's span can land after a later one's.
    // Appending as they fold would produce a plausible-looking but WRONG
    // sequence, which is worse than showing no sequence at all.
    it("still records the order they actually ran in", () => {
      const attributes = foldAll({
        spans: [
          toolSpan("Edit", 4000),
          toolSpan("Read", 1000),
          toolSpan("Bash", 3000),
          toolSpan("Read", 2000),
        ],
      });

      expect(stepNames(attributes)).toEqual(["Read", "Read", "Bash", "Edit"]);
    });
  });

  describe("given a sub-agent that ran its own tools", () => {
    // A sub-agent runs its own conversation and can do twenty reads of its own.
    // Splicing those inline would read as though the MAIN thread did them,
    // destroying the hierarchy. The sub-agent is already represented by the step
    // that spawned it; its detail lives one level down.
    it("keeps the sub-agent's steps out of the main sequence", () => {
      const subAgentRead = {
        name: "claude_code.tool",
        spanAttributes: { tool_name: "Read", agent_id: "agent_abc" },
        startTimeUnixMs: 2500,
        statusCode: null,
      } as unknown as NormalizedSpan;

      const attributes = foldAll({
        spans: [
          toolSpan("Task", 2000),
          subAgentRead,
          toolSpan("Edit", 3000),
        ],
      });

      expect(stepNames(attributes)).toEqual(["Task", "Edit"]);
    });
  });

  describe("given a step that failed", () => {
    it("marks it in place, so the failure reads where it happened", () => {
      const attributes = foldAll({
        spans: [
          toolSpan("Read", 1000),
          toolSpan("Bash", 2000, "error"),
          toolSpan("Edit", 3000),
        ],
      });

      expect(stepNames(attributes)).toEqual(["Read", "Bash!", "Edit"]);
    });
  });
});
