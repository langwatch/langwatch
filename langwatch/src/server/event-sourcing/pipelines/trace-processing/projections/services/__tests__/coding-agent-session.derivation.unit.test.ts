/**
 * The coding-agent session derivation (ADR-040, specs/trace-processing/
 * coding-agent-session.feature).
 *
 * A coding agent's trace IS the session, its facts are split across spans AND
 * logs, and the facts themselves are not agent-specific. These pin the behaviour
 * the spec describes.
 */
import { describe, expect, it } from "vitest";
import type { LogRecordReceivedEventData } from "../../../schemas/events";
import type { NormalizedSpan } from "../../../schemas/spans";
import {
  applyLogToCodingAgentSession,
  applySpanToCodingAgentSession,
  type CodingAgentSessionData,
  createInitCodingAgentSession,
  isCodingAgentSession,
} from "../coding-agent-session.derivation";

function span(
  name: string,
  spanAttributes: Record<string, unknown> = {},
  over: { startTimeUnixMs?: number; endTimeUnixMs?: number; statusCode?: string } = {},
): NormalizedSpan {
  return {
    name,
    spanAttributes,
    startTimeUnixMs: over.startTimeUnixMs ?? 1000,
    endTimeUnixMs: over.endTimeUnixMs ?? 1000,
    statusCode: over.statusCode ?? null,
  } as unknown as NormalizedSpan;
}

function tool(
  toolName: string,
  startedAtMs: number,
  over: { failed?: boolean; durationMs?: number; agentId?: string } = {},
): NormalizedSpan {
  return span(
    "claude_code.tool",
    {
      tool_name: toolName,
      ...(over.agentId ? { agent_id: over.agentId } : {}),
    },
    {
      startTimeUnixMs: startedAtMs,
      endTimeUnixMs: startedAtMs + (over.durationMs ?? 0),
      statusCode: over.failed ? "error" : undefined,
    },
  );
}

function log(attributes: Record<string, string>): LogRecordReceivedEventData {
  return { attributes } as unknown as LogRecordReceivedEventData;
}

type Item = { span: NormalizedSpan } | { log: LogRecordReceivedEventData };

function fold(items: Item[]): CodingAgentSessionData {
  let state = createInitCodingAgentSession();
  for (const item of items) {
    state =
      "span" in item
        ? applySpanToCodingAgentSession({ state, span: item.span })
        : applyLogToCodingAgentSession({ state, data: item.log });
  }
  return state;
}

const stepNames = (s: CodingAgentSessionData) =>
  s.steps.map((x) => (x.count > 1 ? `${x.name} x${x.count}` : x.name));

describe("coding agent session", () => {
  describe("the work it did", () => {
    it("counts model calls, tool runs and sub-agents, and which tools ran", () => {
      const state = fold([
        { span: span("claude_code.llm_request") },
        { span: span("claude_code.llm_request") },
        { span: tool("Read", 1000) },
        { span: tool("Read", 2000) },
        { span: tool("Bash", 3000, { durationMs: 2400 }) },
        { span: span("claude_code.subagent.spawn", { agent_type: "Explore" }) },
      ]);

      expect(state.modelCalls).toBe(2);
      expect(state.toolCalls).toBe(3);
      expect(state.subAgents).toBe(1);
      expect(state.toolCounts).toEqual({ Read: 2, Bash: 1 });
      expect(state.toolDurationMs.Bash).toBe(2400);
      expect(state.subAgentTypes).toEqual(["Explore"]);
    });
  });

  describe("the order things happened", () => {
    it("records the steps in the order they ran", () => {
      const state = fold([
        { span: tool("Read", 1000) },
        { span: tool("Bash", 2000) },
        { span: tool("Edit", 3000) },
        { span: tool("Bash", 4000) },
      ]);

      // A tally would lose the story: it checked, ran, fixed, and re-ran.
      expect(stepNames(state)).toEqual(["Read", "Bash", "Edit", "Bash"]);
    });

    it("batches a back-to-back run of the same tool", () => {
      const state = fold([
        { span: tool("Read", 1000) },
        { span: tool("Read", 2000) },
        { span: tool("Read", 3000) },
        { span: tool("Bash", 4000) },
      ]);

      expect(stepNames(state)).toEqual(["Read x3", "Bash"]);
    });

    it("only batches ADJACENT runs, so a return to a tool stays its own beat", () => {
      const state = fold([
        { span: tool("Read", 1000) },
        { span: tool("Read", 2000) },
        { span: tool("Bash", 3000) },
        { span: tool("Read", 4000) },
      ]);

      expect(stepNames(state)).toEqual(["Read x2", "Bash", "Read"]);
    });

    it("sequences correctly even when the spans ARRIVE out of order", () => {
      // Spans are exported in batches, so a slow tool's span can land after a
      // later one's. A plausible-looking but wrong sequence is worse than none.
      const state = fold([
        { span: tool("Edit", 4000) },
        { span: tool("Read", 1000) },
        { span: tool("Bash", 3000) },
        { span: tool("Read", 2000) },
      ]);

      expect(stepNames(state)).toEqual(["Read x2", "Bash", "Edit"]);
    });

    it("marks a failed step in place, and a batch fails if any run in it failed", () => {
      const state = fold([
        { span: tool("Read", 1000) },
        { span: tool("Bash", 2000, { failed: true }) },
        { span: tool("Bash", 3000) },
        { span: tool("Edit", 4000) },
      ]);

      expect(stepNames(state)).toEqual(["Read", "Bash x2", "Edit"]);
      expect(state.steps[1]?.failed).toBe(true);
      expect(state.failedTools).toBe(1);
    });
  });

  describe("the agent hierarchy", () => {
    it("keeps a sub-agent's tools out of the session's own steps, but still counts the work", () => {
      const state = fold([
        { span: tool("Task", 1000) },
        { span: tool("Read", 1500, { agentId: "agent_abc" }) },
        { span: tool("Read", 1600, { agentId: "agent_abc" }) },
        { span: tool("Edit", 2000) },
      ]);

      expect(stepNames(state)).toEqual(["Task", "Edit"]);
      // The work still happened, so the totals still see it.
      expect(state.toolCalls).toBe(4);
      expect(state.toolCounts.Read).toBe(2);
    });
  });

  describe("how it ended", () => {
    it("takes the FINAL model call's stop reason, not the loop's", () => {
      const state = fold([
        { span: span("claude_code.llm_request", { stop_reason: "tool_use" }) },
        { span: span("claude_code.llm_request", { stop_reason: "tool_use" }) },
        { span: span("claude_code.llm_request", { stop_reason: "end_turn" }) },
      ]);

      expect(state.stopReason).toBe("end_turn");
      expect(state.truncated).toBe(false);
    });

    it("marks a reply cut off by the token limit as truncated, not as an answer", () => {
      const state = fold([
        { span: span("claude_code.llm_request", { stop_reason: "max_tokens" }) },
      ]);

      expect(state.truncated).toBe(true);
    });
  });

  describe("what the human did", () => {
    it("records a tool the user DENIED, which produced no span at all", () => {
      const state = fold([
        {
          log: log({
            "event.name": "tool_decision",
            decision: "reject",
            source: "user_reject",
            tool_name: "Bash",
          }),
        },
      ]);

      expect(state.toolsDenied).toBe(1);
      expect(state.failedTools).toBe(0);
    });

    it("counts an ABORT separately from a denial, and neither as a tool failure", () => {
      const state = fold([
        {
          log: log({
            "event.name": "tool_decision",
            decision: "reject",
            source: "user_abort",
          }),
        },
      ]);

      expect(state.toolsAborted).toBe(1);
      expect(state.toolsDenied).toBe(0);
      // The human's judgement is not the agent's failure.
      expect(state.failedTools).toBe(0);
    });

    it("records the approval mode the session ran under", () => {
      const state = fold([
        { log: log({ "event.name": "permission_mode_changed", to_mode: "plan" }) },
      ]);

      expect(state.permissionMode).toBe("plan");
    });
  });

  describe("what went wrong", () => {
    it("counts API errors, and tells a rate limit apart from the rest", () => {
      const state = fold([
        { log: log({ "event.name": "api_error", status_code: "529" }) },
        { log: log({ "event.name": "api_error", status_code: "429" }) },
        { log: log({ "event.name": "api_retries_exhausted", total_attempts: "5" }) },
        { log: log({ "event.name": "api_refusal" }) },
      ]);

      expect(state.apiErrors).toBe(2);
      expect(state.rateLimited).toBe(1);
      expect(state.retriesExhausted).toBe(1);
      expect(state.refusals).toBe(1);
    });
  });

  describe("what the agent did to itself", () => {
    it("records a compaction and what it cost the context", () => {
      const state = fold([
        {
          log: log({
            "event.name": "compaction",
            pre_tokens: "180000",
            post_tokens: "42000",
          }),
        },
      ]);

      expect(state.compactions).toBe(1);
      expect(state.compactionTokensBefore).toBe(180_000);
      expect(state.compactionTokensAfter).toBe(42_000);
    });
  });

  describe("skills and MCP servers", () => {
    it("collects skills from BOTH the Skill tool span and the log event", () => {
      // A skill invoked proactively arrives on the span; a /slash skill on the
      // event. Reading one path loses half of them.
      const state = fold([
        { span: span("claude_code.tool", { tool_name: "Skill", skill_name: "deep-research" }) },
        { log: log({ "event.name": "skill_activated", "skill.name": "code-review" }) },
      ]);

      expect(state.skills).toEqual(["deep-research", "code-review"]);
    });

    it("records which MCP servers the session used", () => {
      const state = fold([
        {
          span: span("claude_code.tool", {
            tool_name: "mcp__grafana__query",
            "mcp_server.name": "grafana",
          }),
        },
        {
          log: log({
            "event.name": "mcp_server_connection",
            status: "connected",
            server_name: "clickhouse-dev",
          }),
        },
      ]);

      expect(state.mcpServers).toEqual(["grafana", "clickhouse-dev"]);
    });
  });

  describe("boundedness", () => {
    // This is what makes it safe to summarise an unbounded session at all.
    it("does not grow with the length of the session", () => {
      const small = fold(
        Array.from({ length: 10 }, (_, i) => ({ span: tool(`T${i % 3}`, i * 10) })),
      );
      const huge = fold(
        Array.from({ length: 20_000 }, (_, i) => ({
          span: tool(`T${i % 7}`, i * 10),
        })),
      );

      expect(huge.toolCalls).toBe(20_000);
      // The counters grow; the collections do not.
      expect(huge.steps.length).toBeLessThanOrEqual(100);
      expect(huge.filesTouched.length).toBeLessThanOrEqual(50);
      expect(JSON.stringify(huge).length).toBeLessThan(
        JSON.stringify(small).length + 8_000,
      );
    });
  });

  describe("a trace that is not a coding agent", () => {
    it("is not a session", () => {
      const state = fold([{ span: span("openai.chat", { model: "gpt-5-mini" }) }]);

      expect(isCodingAgentSession(state)).toBe(false);
      expect(state.agent).toBeNull();
    });
  });
});
