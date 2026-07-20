/**
 * The coding-agent session derivation (ADR-041, specs/trace-processing/
 * coding-agent-session.feature).
 *
 * A coding agent's trace IS the session, its facts are split across spans AND
 * logs, and the facts themselves are not agent-specific. These pin the behaviour
 * the spec describes.
 */
import { describe, expect, it } from "vitest";
import type { LogRecordReceivedEventData } from "../../../schemas/events";
import {
  type NormalizedSpan,
  NormalizedStatusCode,
} from "../../../schemas/spans";
import {
  applyLogToCodingAgentSession,
  applyMetricToCodingAgentSession,
  applySpanToCodingAgentSession,
  CODING_AGENT_LOG_SCOPES,
  CODING_AGENT_SPAN_NAMES,
  type CodingAgentMetricRecord,
  type CodingAgentSessionData,
  cacheHitRate,
  createInitCodingAgentSession,
  isCodingAgentMetric,
  isCodingAgentSession,
  meanTtftMs,
} from "../coding-agent-session.derivation";

function span(
  name: string,
  spanAttributes: Record<string, unknown> = {},
  // `statusCode` is the OTLP numeric enum, NOT a string. It was typed as
  // `string` here and the fixture fed `"error"` — a value production never
  // emits — while the `as unknown as NormalizedSpan` cast silenced the error
  // that would have said so. The tests passed; the fold marked every failed tool
  // as successful. Type it properly so the fixture cannot drift from reality
  // again.
  over: {
    startTimeUnixMs?: number;
    endTimeUnixMs?: number;
    statusCode?: NormalizedStatusCode;
  } = {},
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
      statusCode: over.failed ? NormalizedStatusCode.ERROR : undefined,
    },
  );
}

function log(attributes: Record<string, string>): LogRecordReceivedEventData {
  return { attributes } as unknown as LogRecordReceivedEventData;
}

function metric(
  metricName: string,
  value: number,
  attributes: Record<string, string> = {},
): CodingAgentMetricRecord {
  return {
    metricName,
    value,
    attributes,
  };
}

type Item =
  | { span: NormalizedSpan }
  | { log: LogRecordReceivedEventData }
  | { metric: CodingAgentMetricRecord };

function fold(items: Item[]): CodingAgentSessionData {
  let state = createInitCodingAgentSession();
  for (const item of items) {
    if ("span" in item) {
      state = applySpanToCodingAgentSession({ state, span: item.span });
    } else if ("log" in item) {
      state = applyLogToCodingAgentSession({ state, data: item.log });
    } else {
      state = applyMetricToCodingAgentSession({ state, data: item.metric });
    }
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
        {
          span: span("claude_code.subagent.spawn", {
            agent_id: "agent_a",
            agent_type: "Explore",
          }),
        },
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
        {
          span: span("claude_code.llm_request", { stop_reason: "max_tokens" }),
        },
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
        {
          log: log({
            "event.name": "permission_mode_changed",
            to_mode: "plan",
          }),
        },
      ]);

      expect(state.permissionMode).toBe("plan");
    });
  });

  describe("what went wrong", () => {
    it("counts API errors, and tells a rate limit apart from the rest", () => {
      const state = fold([
        { log: log({ "event.name": "api_error", status_code: "529" }) },
        { log: log({ "event.name": "api_error", status_code: "429" }) },
        {
          log: log({
            "event.name": "api_retries_exhausted",
            total_attempts: "5",
          }),
        },
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
        {
          span: span("claude_code.tool", {
            tool_name: "Skill",
            skill_name: "deep-research",
          }),
        },
        {
          log: log({
            "event.name": "skill_activated",
            "skill.name": "code-review",
          }),
        },
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
        Array.from({ length: 10 }, (_, i) => ({
          span: tool(`T${i % 3}`, i * 10),
        })),
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
      const state = fold([
        { span: span("openai.chat", { model: "gpt-5-mini" }) },
      ]);

      expect(isCodingAgentSession(state)).toBe(false);
      expect(state.agent).toBeNull();
    });
  });
});

describe("the economics", () => {
  it("separates cache reads from cache CREATION, and reports the hit rate", () => {
    // For a coding agent the expensive mistake is cache invalidation, not raw
    // tokens: a cache read is billed at a fraction of fresh input, while a cache
    // WRITE costs more than it. A session re-creating its cache is burning money
    // in a way raw token counts do not show.
    const state = fold([
      {
        span: span("claude_code.llm_request", {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 900,
          cache_creation_tokens: 200,
        }),
      },
      { log: log({ "event.name": "api_request", cost_usd: "0.42" }) },
    ]);

    expect(state.cacheReadTokens).toBe(900);
    expect(state.cacheCreationTokens).toBe(200);
    expect(state.costUsd).toBeCloseTo(0.42);
    // 900 / (900 + 200 + 100)
    expect(cacheHitRate(state)).toBeCloseTo(0.75);
  });

  it("takes the authoritative cost from the logs, which no span carries", () => {
    const state = fold([
      { log: log({ "event.name": "api_request", cost_usd: "0.10" }) },
      { log: log({ "event.name": "api_request", cost_usd: "0.05" }) },
    ]);

    expect(state.costUsd).toBeCloseTo(0.15);
  });
});

describe("time", () => {
  it("reports the mean time to first token as a foldable sum and count", () => {
    const state = fold([
      { span: span("claude_code.llm_request", { ttft_ms: 400 }) },
      { span: span("claude_code.llm_request", { ttft_ms: 800 }) },
    ]);

    expect(meanTtftMs(state)).toBe(600);
  });

  it("records how long a HUMAN sat waiting to approve a tool", () => {
    // Pure friction: the agent was idle and so was the person. Nothing else in
    // the telemetry surfaces it.
    const state = fold([
      {
        span: span("claude_code.tool.blocked_on_user", { duration_ms: 12_000 }),
      },
      {
        span: span("claude_code.tool.blocked_on_user", { duration_ms: 3_000 }),
      },
    ]);

    expect(state.blockedOnUserMs).toBe(15_000);
  });
});

describe("context pressure", () => {
  it("measures the bytes of tool OUTPUT fed back into the context", () => {
    // The usual cause of a session bloating its way into a compaction.
    const state = fold([
      {
        log: log({
          "event.name": "tool_result",
          tool_result_size_bytes: "40000",
          tool_input_size_bytes: "500",
          success: "true",
        }),
      },
    ]);

    expect(state.toolResultBytes).toBe(40_000);
    expect(state.toolInputBytes).toBe(500);
  });

  it("classifies tool failures by their error type", () => {
    const state = fold([
      {
        log: log({
          "event.name": "tool_result",
          success: "false",
          error_type: "Error:ENOENT",
        }),
      },
      {
        log: log({
          "event.name": "tool_result",
          success: "false",
          error_type: "Error:ENOENT",
        }),
      },
      {
        log: log({
          "event.name": "tool_result",
          success: "false",
          error_type: "ShellError",
        }),
      },
    ]);

    expect(state.errorTypes).toEqual({ "Error:ENOENT": 2, ShellError: 1 });
  });
});

describe("context health", () => {
  it("tracks the biggest single call's context, not the cumulative sum across calls", () => {
    const state = fold([
      {
        span: span("claude_code.llm_request", {
          cache_read_tokens: 5_000,
          cache_creation_tokens: 1_000,
        }),
      },
      {
        span: span("claude_code.llm_request", {
          cache_read_tokens: 60_000,
          cache_creation_tokens: 2_000,
        }),
      },
      {
        span: span("claude_code.llm_request", {
          cache_read_tokens: 10_000,
          cache_creation_tokens: 500,
        }),
      },
    ]);

    // The middle call's context (60,000 + 2,000) is the peak, even though it
    // isn't the last call and isn't the biggest cumulative sum.
    expect(state.peakContextTokens).toBe(62_000);
  });

  it("does not flag the first call as a rebuild — there is nothing to reuse yet", () => {
    const state = fold([
      {
        span: span("claude_code.llm_request", {
          cache_read_tokens: 0,
          cache_creation_tokens: 50_000,
        }),
      },
    ]);

    expect(state.cacheRebuildCount).toBe(0);
  });

  it("flags a call that re-creates most of the prior call's cached context", () => {
    const state = fold([
      // First call establishes a 100,000-token cached context.
      {
        span: span("claude_code.llm_request", {
          cache_read_tokens: 0,
          cache_creation_tokens: 100_000,
        }),
      },
      // Second call re-creates 60,000 of it instead of reading it from cache
      // (60,000 / 100,000 = 60% >= the 50% threshold).
      {
        span: span("claude_code.llm_request", {
          cache_read_tokens: 0,
          cache_creation_tokens: 60_000,
        }),
      },
    ]);

    expect(state.cacheRebuildCount).toBe(1);
    expect(state.largestCacheRebuildTokens).toBe(60_000);
  });

  it("does not flag a small cache write that isn't actually a rebuild", () => {
    const state = fold([
      {
        span: span("claude_code.llm_request", {
          cache_read_tokens: 0,
          cache_creation_tokens: 100_000,
        }),
      },
      // Only 2% of the prior context, and under the 1,000-token floor either way.
      {
        span: span("claude_code.llm_request", {
          cache_read_tokens: 90_000,
          cache_creation_tokens: 500,
        }),
      },
    ]);

    expect(state.cacheRebuildCount).toBe(0);
    expect(state.largestCacheRebuildTokens).toBe(0);
  });

  it("keeps the single worst rebuild across several, not the last one", () => {
    const state = fold([
      {
        span: span("claude_code.llm_request", {
          cache_creation_tokens: 100_000,
        }),
      },
      // Rebuild #1: 60% of 100k.
      {
        span: span("claude_code.llm_request", {
          cache_creation_tokens: 60_000,
        }),
      },
      // Rebuild #2: 90% of 60k, but smaller in absolute tokens than #1.
      {
        span: span("claude_code.llm_request", {
          cache_creation_tokens: 54_000,
        }),
      },
    ]);

    expect(state.cacheRebuildCount).toBe(2);
    expect(state.largestCacheRebuildTokens).toBe(60_000);
  });
});

describe("the guardrails", () => {
  it("counts the hooks that actually BLOCKED an action", () => {
    const state = fold([
      {
        log: log({
          "event.name": "hook_execution_complete",
          num_blocking: "1",
          num_cancelled: "2",
          total_duration_ms: "350",
        }),
      },
    ]);

    expect(state.hooksBlocked).toBe(1);
    expect(state.hooksCancelled).toBe(2);
    expect(state.hookMs).toBe(350);
  });

  it("counts every widening of what the agent was allowed to do", () => {
    const state = fold([
      {
        log: log({
          "event.name": "permission_mode_changed",
          to_mode: "acceptEdits",
        }),
      },
      {
        log: log({
          "event.name": "permission_mode_changed",
          to_mode: "bypassPermissions",
        }),
      },
    ]);

    expect(state.permissionChanges).toBe(2);
    expect(state.permissionMode).toBe("bypassPermissions");
  });

  it("does not count a server-side fallback hop as a refusal the user saw", () => {
    // The API already retried it on another model, so the human never saw it.
    // Counting it would overstate how often the agent refused them.
    const state = fold([
      {
        log: log({ "event.name": "api_refusal", server_fallback_hop: "true" }),
      },
      { log: log({ "event.name": "api_refusal", category: "cyber" }) },
    ]);

    expect(state.refusals).toBe(1);
    expect(state.refusalCategories).toEqual(["cyber"]);
  });
});

describe("what came out of it (metrics)", () => {
  // The metrics are the ONLY signal that says what the session produced. A
  // summary from spans and logs alone can say the agent ran 192 tools and cannot
  // say whether anything came of it.
  it("records lines changed, commits and pull requests", () => {
    const state = fold([
      {
        metric: metric("claude_code.lines_of_code.count", 120, {
          type: "added",
        }),
      },
      {
        metric: metric("claude_code.lines_of_code.count", 30, {
          type: "removed",
        }),
      },
      { metric: metric("claude_code.commit.count", 2) },
      { metric: metric("claude_code.pull_request.count", 1) },
    ]);

    expect(state.linesAdded).toBe(120);
    expect(state.linesRemoved).toBe(30);
    expect(state.commits).toBe(2);
    expect(state.pullRequests).toBe(1);
  });

  it("records whether the human accepted the edits, and in what languages", () => {
    const state = fold([
      {
        metric: metric("claude_code.code_edit_tool.decision", 1, {
          decision: "accept",
          language: "TypeScript",
        }),
      },
      {
        metric: metric("claude_code.code_edit_tool.decision", 1, {
          decision: "reject",
          language: "Python",
        }),
      },
    ]);

    expect(state.editsAccepted).toBe(1);
    expect(state.editsRejected).toBe(1);
    expect(state.languagesEdited).toEqual(["TypeScript", "Python"]);
  });

  it("splits active time between the human and the agent", () => {
    const state = fold([
      {
        metric: metric("claude_code.active_time.total", 300, { type: "user" }),
      },
      { metric: metric("claude_code.active_time.total", 900, { type: "cli" }) },
    ]);

    expect(state.activeTimeUserSec).toBe(300);
    expect(state.activeTimeCliSec).toBe(900);
  });
});

describe("pointers to the heavy data", () => {
  it("keeps ids, and measures the text without carrying it", () => {
    // The projection is an aggregate, not a copy: request_id reaches the exact
    // response body, session.id reaches the rest of the run. No content.
    const state = fold([
      {
        log: log({
          "event.name": "user_prompt",
          prompt_length: "412",
          "session.id": "sess-1",
        }),
      },
      {
        log: log({
          "event.name": "assistant_response",
          response_length: "1800",
        }),
      },
      { span: span("claude_code.llm_request", { request_id: "req_first" }) },
      { span: span("claude_code.llm_request", { request_id: "req_last" }) },
    ]);

    expect(state.sessionId).toBe("sess-1");
    expect(state.prompts).toBe(1);
    expect(state.promptChars).toBe(412);
    expect(state.responseChars).toBe(1800);
    // The LAST call's id — the pointer to the body that ended the session.
    expect(state.finalRequestId).toBe("req_last");
    expect(JSON.stringify(state)).not.toContain("prompt_text");
  });

  it("keeps who ran it: claude stamps user.id on every log event", () => {
    const state = fold([
      {
        log: log({
          "event.name": "user_prompt",
          prompt_length: "5",
          "user.id": "acct-uuid-1",
          "user.email": "dev@example.com",
        }),
      },
    ]);

    expect(state.userId).toBe("acct-uuid-1");
  });

  it("stays null when the agent sends no user identity at all", () => {
    // gemini and opencode events carry no user.* attributes (verified against
    // live telemetry) — an empty guess would be worse than an honest null.
    const state = fold([
      { log: log({ "event.name": "user_prompt", prompt_length: "5" }) },
    ]);

    expect(state.userId).toBeNull();
  });
});

describe("the gate: a trace that is not a coding agent must cost nothing", () => {
  // Every trace in the project flows through this fold. Without a check on the
  // RAW span name, an ordinary chat trace would run the whole canonicalisation
  // registry on every one of its spans only to discover, at the end, that it is
  // not a coding agent.
  it("does not recognise an ordinary LLM span", () => {
    expect(CODING_AGENT_SPAN_NAMES.has("openai.chat")).toBe(false);
    expect(CODING_AGENT_SPAN_NAMES.has("llm")).toBe(false);
    expect(CODING_AGENT_SPAN_NAMES.has("claude_code.llm_request")).toBe(true);
    expect(CODING_AGENT_SPAN_NAMES.has("claude_code.tool")).toBe(true);
  });

  it("does not read a Spring AI or Codex log through the Claude adapter", () => {
    expect(
      CODING_AGENT_LOG_SCOPES.has("com.anthropic.claude_code.events"),
    ).toBe(true);
    expect(CODING_AGENT_LOG_SCOPES.has("codex_cli_rs")).toBe(false);
    expect(
      CODING_AGENT_LOG_SCOPES.has(
        "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
      ),
    ).toBe(false);
  });

  it("ignores metrics that are not the agent's", () => {
    expect(isCodingAgentMetric("claude_code.commit.count")).toBe(true);
    expect(isCodingAgentMetric("gen_ai.client.token.usage")).toBe(false);
  });

  it("never marks a non-agent trace as a session", () => {
    const state = fold([
      { span: span("openai.chat", { model: "gpt-5-mini" }) },
      { span: span("llm", { "gen_ai.usage.input_tokens": 500 }) },
    ]);

    expect(isCodingAgentSession(state)).toBe(false);
    expect(state.agent).toBeNull();
    expect(state.modelCalls).toBe(0);
  });
});

describe("counting sub-agents from what is actually emitted", () => {
  // Measured against real telemetry: claude_code.subagent.spawn is essentially
  // never emitted. Counting spawns reported ZERO sub-agents for a session that
  // had clearly run several (44, 20, 20 and 14 tool spans, each under its own
  // agent_id), and their work then vanished from the step sequence with nothing
  // to explain where it went. The agent_id IS emitted, so that is what we count.
  it("counts distinct sub-agents by agent_id, with no spawn span present", () => {
    const state = fold([
      { span: tool("Task", 1000) },
      { span: tool("Read", 1100, { agentId: "agent_a" }) },
      { span: tool("Read", 1200, { agentId: "agent_a" }) },
      { span: tool("Grep", 1300, { agentId: "agent_b" }) },
      { span: tool("Edit", 2000) },
    ]);

    expect(state.subAgents).toBe(2);
    expect(state.toolCalls).toBe(5);
    // Their work still stays OUT of the main thread's sequence.
    expect(stepNames(state)).toEqual(["Task", "Edit"]);
  });

  it("counts a sub-agent that only made model calls", () => {
    const state = fold([
      { span: span("claude_code.llm_request", { agent_id: "agent_x" }) },
      { span: span("claude_code.llm_request", { agent_id: "agent_x" }) },
      { span: span("claude_code.llm_request") },
    ]);

    expect(state.subAgents).toBe(1);
    expect(state.modelCalls).toBe(3);
  });
});

describe("MCP servers, read off the tool name", () => {
  /**
   * Regression: real sessions that had plainly called an MCP server reported
   * using none.
   *
   * The derivation only looked at `mcp_server.name` / `mcp_tool.name`
   * attributes, and Claude Code does not put them on the tool span. The name
   * itself is what arrives — `mcp__claude-in-chrome__tabs_context_mcp` — so the
   * name is what we parse. (This exact tool name is lifted from a live session.)
   */
  it("names the server and the tool from a real MCP tool span", () => {
    const state = applySpanToCodingAgentSession({
      state: createInitCodingAgentSession(),
      span: tool("mcp__claude-in-chrome__tabs_context_mcp", 1000),
    });

    expect(state.mcpServers).toEqual(["claude-in-chrome"]);
    expect(state.mcpTools).toEqual(["tabs_context_mcp"]);
  });

  it("leaves an ordinary built-in tool alone", () => {
    const state = applySpanToCodingAgentSession({
      state: createInitCodingAgentSession(),
      span: tool("Bash", 1000),
    });

    expect(state.mcpServers).toEqual([]);
    expect(state.mcpTools).toEqual([]);
  });
});
