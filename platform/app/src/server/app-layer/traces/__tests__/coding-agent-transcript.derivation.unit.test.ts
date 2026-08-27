/**
 * The coding-agent transcript, derived on the SERVER.
 *
 * These pin the two properties that made it worth moving off the client: the
 * transcript is ordered by what actually happened (not by which exporter arrived
 * first), and it includes the moments that have NO span — a tool the human
 * refused never runs, so the logs are the only place it exists.
 */
import { describe, expect, it } from "vitest";
import {
  buildCodingAgentTranscript,
  type TranscriptLogRecord,
} from "@langwatch/coding-agent-contract";
import type { SpanDetail } from "@langwatch/trace-contract";

function toolSpan({
  name,
  atMs,
  agentId,
  failed = false,
  spanId = `span-${atMs}`,
}: {
  name: string;
  atMs: number;
  agentId?: string;
  failed?: boolean;
  spanId?: string;
}): SpanDetail {
  return {
    spanId,
    name: "claude_code.tool",
    startTimeMs: atMs,
    endTimeMs: atMs + 100,
    status: failed ? "error" : "ok",
    params: { tool_name: name, ...(agentId ? { agent_id: agentId } : {}) },
    input: "{}",
    output: "ok",
  } as unknown as SpanDetail;
}

function modelSpan({ atMs, cost = 0.5 }: { atMs: number; cost?: number }): SpanDetail {
  return {
    spanId: `llm-${atMs}`,
    name: "claude_code.llm_request",
    startTimeMs: atMs,
    endTimeMs: atMs + 500,
    status: "ok",
    metrics: { promptTokens: 100, completionTokens: 20, cost },
    params: {},
  } as unknown as SpanDetail;
}

function log(attributes: Record<string, unknown>, timestampMs: number): TranscriptLogRecord {
  return { timestampMs, attributes };
}

describe("buildCodingAgentTranscript", () => {
  describe("given a session's spans and logs", () => {
    it("tells the story in the order it happened, across BOTH streams", () => {
      // Spans and logs arrive on separate exporters and separate batches, so the
      // order they are handed to us says nothing about what happened first.
      const transcript = buildCodingAgentTranscript({
        spans: [toolSpan({ name: "Bash", atMs: 3_000 }), modelSpan({ atMs: 2_000 })],
        logs: [
          log({ "event.name": "assistant_response", response: "Done." }, 4_000),
          log({ "event.name": "user_prompt", prompt: "fix the build" }, 1_000),
        ],
      });

      expect(transcript.entries.map((e) => e.kind)).toEqual([
        "user_prompt",
        "model_call",
        "tool",
        "assistant_message",
      ]);
      expect(transcript.entries[0]).toMatchObject({ text: "fix the build" });
    });
  });

  describe("given a model call span", () => {
    it("carries its own tokens and cost, positioned where it happened", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [modelSpan({ atMs: 2_000, cost: 0.75 })],
        logs: [],
      });

      expect(transcript.entries).toEqual([
        {
          kind: "model_call",
          atMs: 2_000,
          model: null,
          tokens: 120,
          costUsd: 0.75,
          durationMs: 500,
          spanId: "llm-2000",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      ]);
    });

    it("carries the cache split, not just the total", () => {
      const span = {
        spanId: "llm-1",
        name: "claude_code.llm_request",
        startTimeMs: 1_000,
        endTimeMs: 1_500,
        status: "ok",
        metrics: { promptTokens: 100, completionTokens: 20, cost: 0.1 },
        params: {
          input_tokens: "2000",
          output_tokens: "150",
          cache_read_tokens: "14000000",
          cache_creation_tokens: "284000",
        },
      } as unknown as SpanDetail;

      const transcript = buildCodingAgentTranscript({
        spans: [span],
        logs: [],
      });

      expect(transcript.entries[0]).toMatchObject({
        cacheReadTokens: 14_000_000,
        cacheCreationTokens: 284_000,
        inputTokens: 2_000,
        outputTokens: 150,
      });
    });
  });

  describe("given a tool the human REFUSED", () => {
    /**
     * The reason logs are not optional. A denied tool never runs, so it has no
     * span anywhere in the trace — read only the spans and the transcript
     * silently omits the moment someone said no.
     */
    it("keeps it in the transcript, since nothing else records it", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [
          log(
            {
              "event.name": "tool_decision",
              decision: "reject",
              tool_name: "Bash",
              source: "user_reject",
            },
            1_000,
          ),
        ],
      });

      expect(transcript.entries).toEqual([
        {
          kind: "tool_rejected",
          atMs: 1_000,
          name: "Bash",
          reason: "user_reject",
        },
      ]);
    });

    it("does not clutter it with the tools they ACCEPTED", () => {
      // An accepted decision is already told by the tool span that follows it.
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [
          log(
            {
              "event.name": "tool_decision",
              decision: "accept",
              tool_name: "Read",
            },
            1_000,
          ),
        ],
      });

      expect(transcript.entries).toEqual([]);
    });
  });

  describe("given a sub-agent's tools", () => {
    // Dropping them lost the work entirely; flattening them into the main thread
    // claimed the main thread did it. Marked in place is the only honest option.
    it("keeps them in sequence, marked, and counts the sub-agent", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          toolSpan({ name: "Read", atMs: 1_000 }),
          toolSpan({ name: "Grep", atMs: 2_000, agentId: "agent-7" }),
          toolSpan({ name: "Grep", atMs: 3_000, agentId: "agent-7" }),
        ],
        logs: [],
      });

      expect(transcript.entries).toHaveLength(3);
      expect(transcript.subAgents).toEqual([{ agentId: "agent-7", toolCalls: 2 }]);
      expect(transcript.totals.toolCalls).toBe(3);
    });
  });

  describe("given an MCP tool", () => {
    it("names the server it came from", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [toolSpan({ name: "mcp__claude-in-chrome__navigate", atMs: 1_000 })],
        logs: [],
      });

      expect(transcript.entries[0]).toMatchObject({
        kind: "tool",
        mcpServer: "claude-in-chrome",
      });
    });
  });

  describe("given a failed tool", () => {
    it("marks it, from the span status alone", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [toolSpan({ name: "Bash", atMs: 1_000, failed: true })],
        logs: [],
      });

      expect(transcript.entries[0]).toMatchObject({ failed: true });
    });
  });

  describe("totals", () => {
    it("sum the whole loop, not just its last hop", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [modelSpan({ atMs: 1_000 }), modelSpan({ atMs: 2_000 })],
        logs: [],
      });

      expect(transcript.totals.modelCalls).toBe(2);
      expect(transcript.totals.tokens).toBe(240);
      expect(transcript.totals.costUsd).toBeCloseTo(1);
    });
  });

  describe("given an opencode session", () => {
    // opencode carries the tool name IN the span name and sends no rolling
    // message history at all — the reason this derivation orders by timestamp
    // rather than parsing a vendor's conversation format.
    it("reads its tools out of the span names", () => {
      const span = {
        spanId: "s-1",
        name: "opencode.tool.bash",
        startTimeMs: 1_000,
        endTimeMs: 1_200,
        status: "ok",
        params: {},
      } as unknown as SpanDetail;

      const transcript = buildCodingAgentTranscript({
        spans: [span],
        logs: [],
      });

      expect(transcript.agent).toBe("opencode");
      expect(transcript.entries[0]).toMatchObject({
        kind: "tool",
        name: "bash",
      });
    });
  });

  describe("given something that went wrong", () => {
    it("tells a rate limit apart from every other failure", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [
          log({ "event.name": "api_error", status_code: "429" }, 1_000),
          log({ "event.name": "api_error", status_code: "500" }, 2_000),
        ],
      });

      expect(transcript.entries[0]).toMatchObject({
        kind: "note",
        level: "error",
        text: "Rate limited by the provider.",
      });
      expect(transcript.entries[1]).toMatchObject({
        text: "The request failed (500).",
      });
    });
  });

  describe("given a mid-session compaction", () => {
    it("reports the token count before and after, not just that it happened", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [
          log(
            {
              "event.name": "compaction",
              pre_tokens: "142000",
              post_tokens: "18000",
              trigger: "auto",
            },
            1_000,
          ),
        ],
      });

      expect(transcript.entries[0]).toMatchObject({
        kind: "note",
        text: "Context compacted (auto): 142k → 18k tokens",
      });
    });
  });

  describe("given a span that declares its tool by attribute under an unfamiliar name", () => {
    it("keeps the tool: the declaration is the evidence, not the span name", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            spanId: "t1",
            name: "mcp.tools.call",
            startTimeMs: 1_000,
            endTimeMs: 1_200,
            status: "ok",
            params: { "tool.name": "search_docs" },
          } as unknown as SpanDetail,
        ],
        logs: [],
      });

      expect(transcript.entries).toMatchObject([{ kind: "tool", name: "search_docs" }]);
      expect(transcript.totals.toolCalls).toBe(1);
    });
  });

  describe("given claude's nested tool lifecycle spans", () => {
    it("counts the tool once: the execution/blocked children declare no tool of their own", () => {
      // Verified against live telemetry: only `claude_code.tool` carries
      // `tool_name`; the `.execution` and `.blocked_on_user` children do not.
      const transcript = buildCodingAgentTranscript({
        spans: [
          toolSpan({ name: "Bash", atMs: 1_000 }),
          {
            spanId: "exec",
            name: "claude_code.tool.execution",
            startTimeMs: 1_010,
            endTimeMs: 1_090,
            status: "ok",
            params: {},
          } as unknown as SpanDetail,
          {
            spanId: "blocked",
            name: "claude_code.tool.blocked_on_user",
            startTimeMs: 1_001,
            endTimeMs: 1_005,
            status: "ok",
            params: {},
          } as unknown as SpanDetail,
        ],
        logs: [],
      });

      expect(transcript.totals.toolCalls).toBe(1);
      expect(transcript.entries.filter((entry) => entry.kind === "tool")).toHaveLength(1);
    });
  });

  describe("given session milestone events", () => {
    it("turns refusals, sub-agent spawns, commits and skill activations into notes", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [
          log({ "event.name": "claude_code.api_refusal" }, 1_000),
          log(
            {
              "event.name": "claude_code.subtask_invoked",
              description: "review the diff",
            },
            2_000,
          ),
          log({ "event.name": "claude_code.commit" }, 3_000),
          log({ "event.name": "claude_code.skill_activated", skill_name: "pdf" }, 4_000),
        ],
      });

      expect(transcript.entries).toMatchObject([
        { kind: "note", level: "error", text: "The model refused to answer." },
        {
          kind: "note",
          level: "info",
          text: "Sub-agent spawned: review the diff",
        },
        { kind: "note", level: "info", text: "A commit was created." },
        { kind: "note", level: "info", text: "Skill activated: pdf" },
      ]);
    });
  });

  describe("given a trace that is not a coding agent", () => {
    it("returns an empty transcript rather than guessing at one", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            spanId: "s",
            name: "openai.chat",
            startTimeMs: 1,
          } as unknown as SpanDetail,
        ],
        logs: [],
      });

      expect(transcript.agent).toBe("unknown");
      expect(transcript.entries).toEqual([]);
    });
  });
});

describe("buildCodingAgentTranscript for non-claude agents", () => {
  describe("given a gemini session (llm_call spans + gemini_cli.* events)", () => {
    const geminiResponse = JSON.stringify([
      {
        candidates: [
          {
            content: {
              parts: [
                { text: "**Thinking it over**", thought: true },
                { text: "pong" },
                { text: "", thoughtSignature: "abc" },
              ],
            },
          },
        ],
      },
    ]);

    const spans = [
      {
        spanId: "llm-1",
        name: "llm_call",
        startTimeMs: 1_000,
        endTimeMs: 1_400,
        status: "ok",
        metrics: { promptTokens: 2_458, completionTokens: 44 },
        params: { "gen_ai.request.model": "gemini-3.5-flash" },
        output: JSON.stringify({
          type: "chat_messages",
          value: [{ role: "assistant", content: "pong" }],
        }),
      } as unknown as SpanDetail,
    ];
    const logs = [
      log(
        {
          "event.name": "gemini_cli.user_prompt",
          "session.id": "sess-g",
          prompt: "reply with the single word pong",
        },
        900,
      ),
      log(
        {
          "event.name": "gemini_cli.api_response",
          role: "utility_router",
          model: "gemini-3.1-flash-lite",
          response_text: JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"complexity":"trivial"}' }] } }],
          }),
        },
        950,
      ),
      log(
        {
          "event.name": "gemini_cli.api_response",
          role: "main",
          model: "gemini-3.5-flash",
          response_text: geminiResponse,
        },
        1_500,
      ),
      log(
        {
          "event.name": "gemini_cli.tool_call",
          function_name: "read_file",
          success: "true",
          duration_ms: "42",
        },
        1_200,
      ),
    ];

    it("keeps the reply, skips the thinking, and ignores the router call", () => {
      const transcript = buildCodingAgentTranscript({ spans, logs });

      const replies = transcript.entries.filter((entry) => entry.kind === "assistant_message");
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({
        text: "pong",
        model: "gemini-3.5-flash",
      });
      expect(JSON.stringify(transcript.entries)).not.toContain("Thinking it over");
      expect(JSON.stringify(transcript.entries)).not.toContain("complexity");
    });

    it("derives the user prompt, the tool call, and the model call", () => {
      const transcript = buildCodingAgentTranscript({ spans, logs });

      expect(transcript.entries.find((entry) => entry.kind === "user_prompt")).toMatchObject({
        text: "reply with the single word pong",
      });
      expect(transcript.entries.find((entry) => entry.kind === "tool")).toMatchObject({
        name: "read_file",
        durationMs: 42,
        failed: false,
      });
      expect(transcript.totals.modelCalls).toBe(1);
      expect(transcript.agent).toBe("gemini_cli");
    });

    it("keeps a later turn's span reply when only THAT turn's log was lost", () => {
      // The log read is capped, so a long session can have log replies for
      // some turns and not others. Suppression is per call: a turn whose
      // api_response never arrived must keep its span-derived text.
      const laterTurnSpan = {
        spanId: "llm-2",
        name: "llm_call",
        startTimeMs: 60_000,
        endTimeMs: 61_000,
        status: "ok",
        metrics: { promptTokens: 100, completionTokens: 5 },
        params: { "gen_ai.request.model": "gemini-3.5-flash" },
        output: JSON.stringify({
          type: "chat_messages",
          value: [{ role: "assistant", content: "second answer" }],
        }),
      } as unknown as SpanDetail;

      const transcript = buildCodingAgentTranscript({
        spans: [...spans, laterTurnSpan],
        logs,
      });

      const replies = transcript.entries.filter((entry) => entry.kind === "assistant_message");
      expect(replies.map((reply) => reply.text)).toEqual(["pong", "second answer"]);
    });
  });

  describe("given a codex session (contentless turn spans)", () => {
    it("derives a model call with the turn's token usage", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            spanId: "turn-1",
            name: "session_task.turn",
            startTimeMs: 1_000,
            endTimeMs: 2_554,
            status: "ok",
            params: {
              "codex.turn.token_usage.total_tokens": "12902",
              "codex.turn.token_usage.non_cached_input_tokens": "2913",
              "gen_ai.usage.cache_read.input_tokens": "9984",
            },
          } as unknown as SpanDetail,
        ],
        logs: [],
      });

      expect(transcript.totals.modelCalls).toBe(1);
      const call = transcript.entries.find((entry) => entry.kind === "model_call");
      expect(call).toMatchObject({
        tokens: 12_902,
        inputTokens: 2_913,
        cacheReadTokens: 9_984,
      });
    });
  });

  describe("given an opencode session (Vercel AI SDK spans, no log events)", () => {
    it("counts ai.streamText once and takes the reply from the span output", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            spanId: "st-1",
            name: "ai.streamText",
            startTimeMs: 1_000,
            endTimeMs: 3_000,
            status: "ok",
            metrics: { promptTokens: 2_300, completionTokens: 12 },
            params: { "gen_ai.request.model": "xiaomi/mimo-v2.5" },
            output: JSON.stringify({ type: "text", value: "pong" }),
          } as unknown as SpanDetail,
          {
            spanId: "st-1-inner",
            name: "ai.streamText.doStream",
            startTimeMs: 1_010,
            endTimeMs: 2_990,
            status: "ok",
            metrics: { promptTokens: 2_300, completionTokens: 12 },
            params: {},
          } as unknown as SpanDetail,
        ],
        logs: [],
      });

      expect(transcript.totals.modelCalls).toBe(1);
      expect(transcript.entries.find((entry) => entry.kind === "assistant_message")).toMatchObject({
        text: "pong",
      });
    });
  });

  describe("given a copilot session (chat <model> spans)", () => {
    it("recognizes the model-named chat span as a model call", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            spanId: "chat-1",
            name: "chat gpt-5-mini",
            startTimeMs: 1_000,
            endTimeMs: 2_000,
            status: "ok",
            metrics: { promptTokens: 900, completionTokens: 5 },
            params: { "gen_ai.request.model": "gpt-5-mini" },
          } as unknown as SpanDetail,
        ],
        logs: [],
      });

      expect(transcript.totals.modelCalls).toBe(1);
    });
  });
});

describe("buildCodingAgentTranscript for codex 0.146 sessions", () => {
  const codexToolResultLog = ({
    atMs,
    callId,
    toolName,
    args,
    output,
    success = "true",
  }: {
    atMs: number;
    callId: string;
    toolName: string;
    args: string;
    output: string;
    success?: string;
  }) =>
    log(
      {
        "event.name": "codex.tool_result",
        call_id: callId,
        tool_name: toolName,
        arguments: args,
        output,
        success,
        duration_ms: "523",
        model: "gpt-5.6",
      },
      atMs,
    );

  describe("given tool_result log events carrying arguments and output", () => {
    /** @scenario "A codex session shows its prompt and its tool calls with real input and output" */
    it("renders each tool call with its name, input, and output", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [
          log(
            {
              "event.name": "codex.user_prompt",
              prompt: "check hello.py",
              "conversation.id": "conv-1",
            },
            1_000,
          ),
          codexToolResultLog({
            atMs: 2_000,
            callId: "call_A",
            toolName: "exec",
            args: '{"cmd":"rg -n def hello.py"}',
            output: "1:def welcome(name):",
          }),
        ],
      });

      const tool = transcript.entries.find((e) => e.kind === "tool");
      expect(tool).toMatchObject({
        name: "exec",
        input: { cmd: "rg -n def hello.py" },
        output: "1:def welcome(name):",
        failed: false,
      });
      expect(transcript.entries.findIndex((e) => e.kind === "user_prompt")).toBeLessThan(
        transcript.entries.findIndex((e) => e.kind === "tool"),
      );
    });

    it("marks a failed tool_result as failed", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [
          codexToolResultLog({
            atMs: 2_000,
            callId: "call_B",
            toolName: "exec_command",
            args: '{"cmd":"false"}',
            output: "exit 1",
            success: "false",
          }),
        ],
      });
      expect(transcript.entries.find((e) => e.kind === "tool")).toMatchObject({
        failed: true,
      });
    });
  });

  describe("given a tool span and a tool_result log for the same call id", () => {
    /** @scenario "A tool the agent ran once is shown once" */
    it("renders the call once, on the span, filled with the log's content", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            spanId: "span-exec-1",
            name: "exec_command",
            startTimeMs: 2_000,
            endTimeMs: 2_500,
            status: "ok",
            params: { tool_name: "exec_command", call_id: "exec-1" },
            input: null,
            output: null,
          } as unknown as SpanDetail,
        ],
        logs: [
          codexToolResultLog({
            atMs: 2_400,
            callId: "exec-1",
            toolName: "exec_command",
            args: '{"cmd":"ls"}',
            output: "hello.py",
          }),
        ],
      });

      const tools = transcript.entries.filter((e) => e.kind === "tool");
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        spanId: "span-exec-1",
        input: { cmd: "ls" },
        output: "hello.py",
      });
    });
  });

  describe("given usage-bearing response spans and no turn rollup (the exec wire)", () => {
    /** @scenario "Every model call in a codex exec session is shown with its token counts" */
    it("derives one model call per response span with its token counts", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            spanId: "hr-1",
            name: "handle_responses",
            startTimeMs: 1_000,
            endTimeMs: 1_900,
            status: "ok",
            params: {
              "gen_ai.usage.input_tokens": "13005",
              "gen_ai.usage.output_tokens": "10",
              "gen_ai.usage.cache_read.input_tokens": "12032",
              "gen_ai.usage.cache_write.input_tokens": "256",
            },
          } as unknown as SpanDetail,
          {
            spanId: "hr-idle",
            name: "handle_responses",
            startTimeMs: 2_000,
            endTimeMs: 2_100,
            status: "ok",
            params: { from: "output_item_done" },
          } as unknown as SpanDetail,
        ],
        logs: [],
      });

      expect(transcript.totals.modelCalls).toBe(1);
      expect(transcript.entries.find((e) => e.kind === "model_call")).toMatchObject({
        inputTokens: 13_005,
        outputTokens: 10,
        cacheReadTokens: 12_032,
        cacheCreationTokens: 256,
      });
    });

    it("does NOT double-count response spans when the turn rollup exists", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            spanId: "turn-1",
            name: "session_task.turn",
            startTimeMs: 900,
            endTimeMs: 2_600,
            status: "ok",
            params: { "codex.turn.token_usage.total_tokens": "12902" },
          } as unknown as SpanDetail,
          {
            spanId: "hr-1",
            name: "handle_responses",
            startTimeMs: 1_000,
            endTimeMs: 1_900,
            status: "ok",
            params: {
              "gen_ai.usage.input_tokens": "13005",
              "gen_ai.usage.output_tokens": "10",
            },
          } as unknown as SpanDetail,
        ],
        logs: [],
      });

      expect(transcript.totals.modelCalls).toBe(1);
    });
  });
});

describe("buildCodingAgentTranscript session system context", () => {
  // The bare message array is what `buildDisplayInput` hands the transcript
  // (`JSON.stringify(io.value)`), so that is the shape these pin.
  const chatInput = JSON.stringify([
    { role: "system", content: "You are Claude Code. CLAUDE.md says X." },
    { role: "user", content: "hello" },
  ]);

  describe("given a claude session whose first model call input carries a system message", () => {
    /** @scenario "The session's system context is shown once at the top" */
    it("pins one collapsed system context entry above the first prompt", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          {
            ...modelSpan({ atMs: 2_000 }),
            input: chatInput,
          } as unknown as SpanDetail,
          {
            ...modelSpan({ atMs: 5_000 }),
            spanId: "llm-5000",
            input: chatInput,
          } as unknown as SpanDetail,
        ],
        logs: [
          log(
            {
              "event.name": "user_prompt",
              prompt: "hello",
              "session.id": "sess-1",
            },
            1_000,
          ),
        ],
      });

      const systemEntries = transcript.entries.filter((e) => e.kind === "system_prompt");
      expect(systemEntries).toHaveLength(1);
      expect(systemEntries[0]).toMatchObject({
        text: "You are Claude Code. CLAUDE.md says X.",
      });
      expect(transcript.entries[0]!.kind).toBe("system_prompt");
    });
  });

  describe("given model calls without a system message", () => {
    it("emits no system context entry", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [modelSpan({ atMs: 2_000 })],
        logs: [],
      });
      expect(transcript.entries.some((e) => e.kind === "system_prompt")).toBe(false);
    });
  });
});

describe("buildCodingAgentTranscript injected session context", () => {
  describe("given a first user message carrying system-reminder blocks", () => {
    it("surfaces the injected context, without the user's own words", () => {
      const input = JSON.stringify([
        {
          role: "user",
          content:
            "<system-reminder>\n# claudeMd\nContents of CLAUDE.md: always use pnpm.\n</system-reminder>\n\nRead hello.py and explain it",
        },
      ]);
      const transcript = buildCodingAgentTranscript({
        spans: [{ ...modelSpan({ atMs: 2_000 }), input } as unknown as SpanDetail],
        logs: [],
      });

      const system = transcript.entries.find((e) => e.kind === "system_prompt");
      expect(system).toBeDefined();
      expect((system as { text: string }).text).toContain("always use pnpm");
      expect((system as { text: string }).text).not.toContain("Read hello.py and explain it");
    });
  });

  describe("given both a system turn and system-reminder blocks", () => {
    // Spelled with the `{type, value}` wrapper (the in-process shape) where
    // the cases above use the bare array the read path serializes, so both
    // shapes stay covered.
    it("shows both, since they carry different halves of the context", () => {
      const input = JSON.stringify({
        type: "chat_messages",
        value: [
          { role: "system", content: "You are Claude Code." },
          {
            role: "user",
            content: "<system-reminder>MCP tools: grafana</system-reminder>\n\nhi",
          },
        ],
      });
      const transcript = buildCodingAgentTranscript({
        spans: [{ ...modelSpan({ atMs: 2_000 }), input } as unknown as SpanDetail],
        logs: [],
      });

      const text = (
        transcript.entries.find((e) => e.kind === "system_prompt") as {
          text: string;
        }
      ).text;
      expect(text).toContain("You are Claude Code.");
      expect(text).toContain("MCP tools: grafana");
    });
  });

  describe("given a plain conversation with no injected context", () => {
    it("emits no session context entry", () => {
      const input = JSON.stringify([{ role: "user", content: "just a question" }]);
      const transcript = buildCodingAgentTranscript({
        spans: [{ ...modelSpan({ atMs: 2_000 }), input } as unknown as SpanDetail],
        logs: [],
      });
      expect(transcript.entries.some((e) => e.kind === "system_prompt")).toBe(false);
    });
  });
});

/**
 * Codex exports no conversation content, so a codex trace's prompts, tool calls
 * and replies arrive on a separate span the harvest writes from the session
 * transcript. Before this was understood here, the Terminal view rendered
 * "this agent reported tokens and timing only" over a trace that plainly had a
 * conversation on it.
 */
function recoveredCodexTurn({
  atMs,
  messages,
  output,
  spanId = `codex-io-${atMs}`,
}: {
  atMs: number;
  messages: unknown[];
  output: string;
  spanId?: string;
}): SpanDetail {
  return {
    spanId,
    name: "codex.turn.response",
    startTimeMs: atMs,
    endTimeMs: atMs + 900,
    status: "ok",
    params: { "gen_ai.request.model": "gpt-5-mini" },
    input: JSON.stringify({ type: "chat_messages", value: messages }),
    output,
  } as unknown as SpanDetail;
}

function codexTokenSpan({ atMs }: { atMs: number }): SpanDetail {
  return {
    spanId: `codex-turn-${atMs}`,
    name: "session_task.turn",
    startTimeMs: atMs,
    endTimeMs: atMs + 900,
    status: "ok",
    metrics: { promptTokens: 58000, completionTokens: 200, cost: 0.16 },
    params: {},
  } as unknown as SpanDetail;
}

describe("given a codex trace whose conversation was recovered", () => {
  const turn = () =>
    recoveredCodexTurn({
      atMs: 1_000,
      messages: [
        { role: "system", content: "You are codex." },
        {
          role: "user",
          content: "echo papaya-toolcall and tell me the output",
        },
        { role: "assistant", content: "I'll run that exact command." },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "exec", arguments: '{"cmd":"echo papaya"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "papaya-toolcall" },
      ],
      output: "It printed exactly: papaya-toolcall",
    });

  describe("when the session transcript is derived", () => {
    /** @scenario "The terminal view replays a recovered codex session" */
    it("replays the prompt, the tool call and the reply as readable entries", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [codexTokenSpan({ atMs: 1_000 }), turn()],
        logs: [],
      });

      const readable = transcript.entries.filter((e) => e.kind !== "model_call");
      expect(readable.map((e) => e.kind)).toEqual(
        expect.arrayContaining(["system_prompt", "user_prompt", "tool", "assistant_message"]),
      );
      const prompt = readable.find((e) => e.kind === "user_prompt");
      expect(prompt).toMatchObject({
        text: "echo papaya-toolcall and tell me the output",
      });
      const tool = readable.find((e) => e.kind === "tool");
      expect(tool).toMatchObject({ name: "exec", output: "papaya-toolcall" });
      const reply = readable.filter((e) => e.kind === "assistant_message").at(-1);
      expect(reply).toMatchObject({
        text: "It printed exactly: papaya-toolcall",
      });
    });

    /** @scenario "A recovered turn does not inflate the session's model call count" */
    it("counts codex's own model call once, not once more for the recovered turn", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [codexTokenSpan({ atMs: 1_000 }), turn()],
        logs: [],
      });

      expect(transcript.totals.modelCalls).toBe(1);
    });
  });
});

describe("given a codex session of two turns, where each turn re-sends the whole conversation", () => {
  describe("when the session transcript is derived", () => {
    /** @scenario "A multi-turn session shows each prompt once" */
    it("shows the first prompt and reply once rather than once per turn", () => {
      const first = [
        { role: "system", content: "You are codex." },
        { role: "user", content: "first question" },
      ];
      const transcript = buildCodingAgentTranscript({
        spans: [
          recoveredCodexTurn({
            atMs: 1_000,
            messages: first,
            output: "first answer",
          }),
          recoveredCodexTurn({
            atMs: 2_000,
            messages: [
              ...first,
              { role: "assistant", content: "first answer" },
              { role: "user", content: "second question" },
            ],
            output: "second answer",
          }),
        ],
        logs: [],
      });

      const texts = transcript.entries.flatMap((e) =>
        e.kind === "user_prompt" || e.kind === "assistant_message" ? [e.text] : [],
      );
      expect(texts.filter((t) => t === "first question")).toHaveLength(1);
      expect(texts.filter((t) => t === "first answer")).toHaveLength(1);
      expect(texts).toContain("second question");
      expect(texts).toContain("second answer");
    });
  });
});

describe("given a recovered codex turn whose first user message is the agent's own plugin and environment listing", () => {
  describe("when the session transcript is derived", () => {
    /** @scenario "Context the agent injected under the user's name is not shown as their prompt" */
    it("folds the listing into the session context and leaves the human's words as the prompt", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          recoveredCodexTurn({
            atMs: 1_000,
            messages: [
              { role: "system", content: "You are codex." },
              {
                role: "user",
                content:
                  "<recommended_plugins>\n- Airtable\n- Asana\n</recommended_plugins>\n<environment_context>\n<shell>zsh</shell>\n</environment_context>",
              },
              { role: "user", content: "echo papaya and tell me the output" },
            ],
            output: "papaya",
          }),
        ],
        logs: [],
      });

      const prompts = transcript.entries.filter((e) => e.kind === "user_prompt");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({
        text: "echo papaya and tell me the output",
      });

      const context = transcript.entries.find((e) => e.kind === "system_prompt");
      expect(context?.kind === "system_prompt" && context.text).toContain("recommended_plugins");
    });
  });
});

describe("given the two recovered turns arrive newest-first", () => {
  describe("when the session transcript is derived", () => {
    /**
     * Spans arrive in whatever order their exporter batched them, and the
     * replay takes the tail past the previous turn, so an out-of-order pair
     * would silently drop the earlier turn's prompt entirely.
     *
     * @scenario "A multi-turn session shows each prompt once"
     */
    it("still shows each prompt exactly once, in the order they were asked", () => {
      const first = [
        { role: "system", content: "You are codex." },
        { role: "user", content: "first question" },
      ];
      const turnOne = recoveredCodexTurn({
        atMs: 1_000,
        messages: first,
        output: "first answer",
        spanId: "codex-io-1",
      });
      const turnTwo = recoveredCodexTurn({
        atMs: 2_000,
        messages: [
          ...first,
          { role: "assistant", content: "first answer" },
          { role: "user", content: "second question" },
        ],
        output: "second answer",
        spanId: "codex-io-2",
      });

      const transcript = buildCodingAgentTranscript({
        spans: [turnTwo, turnOne],
        logs: [],
      });

      const texts = transcript.entries.flatMap((e) =>
        e.kind === "user_prompt" || e.kind === "assistant_message" ? [e.text] : [],
      );
      expect(texts.filter((t) => t === "first question")).toHaveLength(1);
      expect(texts.filter((t) => t === "second question")).toHaveLength(1);
      expect(texts.filter((t) => t === "first answer")).toHaveLength(1);
    });
  });
});

/**
 * One tool run, described three times over: the recovered conversation carries
 * the arguments and the result, codex's tool span carries the wall time and the
 * status, its tool_result log carries both. All three name the same call_id.
 */
describe("given a codex trace whose recovered conversation and tool spans describe the same call", () => {
  const callId = "call_papaya";

  const transcriptOfAllThreeSignals = ({
    spanFailed = false,
  }: {
    spanFailed?: boolean;
  } = {}) =>
    buildCodingAgentTranscript({
      spans: [
        recoveredCodexTurn({
          atMs: 1_000,
          messages: [
            { role: "user", content: "echo papaya" },
            {
              role: "assistant",
              tool_calls: [
                {
                  id: callId,
                  type: "function",
                  function: {
                    name: "exec",
                    arguments: '{"cmd":"echo papaya"}',
                  },
                },
              ],
            },
            { role: "tool", tool_call_id: callId, content: "papaya" },
          ],
          output: "It printed papaya",
        }),
        {
          spanId: "span-exec-1",
          name: "exec_command",
          startTimeMs: 1_100,
          endTimeMs: 1_600,
          status: spanFailed ? "error" : "ok",
          params: { tool_name: "exec", call_id: callId },
          input: null,
          output: null,
        } as unknown as SpanDetail,
      ],
      logs: [
        log(
          {
            "event.name": "codex.tool_result",
            call_id: callId,
            tool_name: "exec",
            arguments: '{"cmd":"echo papaya"}',
            output: "papaya",
            success: "true",
            duration_ms: "523",
          },
          1_500,
        ),
      ],
    });

  describe("when the session transcript is derived", () => {
    /** @scenario "A tool run recovered from the transcript and reported as a span is shown once" */
    it("renders that call once and counts it once", () => {
      const transcript = transcriptOfAllThreeSignals();

      expect(transcript.entries.filter((entry) => entry.kind === "tool")).toHaveLength(1);
      expect(transcript.totals.toolCalls).toBe(1);
    });

    /** @scenario "The shown tool call keeps the timing and status only the span measured" */
    it("fills the one entry with the timing the span measured", () => {
      const transcript = transcriptOfAllThreeSignals();

      expect(transcript.entries.find((entry) => entry.kind === "tool")).toMatchObject({
        name: "exec",
        output: "papaya",
        durationMs: 500,
      });
    });

    /** @scenario "The shown tool call keeps the timing and status only the span measured" */
    it("marks the call failed when the span is the only signal saying so", () => {
      const transcript = transcriptOfAllThreeSignals({ spanFailed: true });

      expect(transcript.entries.find((entry) => entry.kind === "tool")).toMatchObject({
        failed: true,
      });
    });
  });
});

describe("given a codex trace whose recovered conversation and prompt event describe the same prompt", () => {
  // Codex withholds the prompt text on its user_prompt event by design: the
  // literal "[REDACTED]" rides the prompt attribute and only the length is
  // real. The recovered conversation carries the words.
  const redactedPromptEvent = () =>
    log(
      {
        "event.name": "codex.user_prompt",
        prompt: "[REDACTED]",
        prompt_length: "34",
        "conversation.id": "conv-1",
      },
      1_042,
    );

  describe("when the session transcript is derived", () => {
    /** @scenario "A prompt recovered from the transcript is not shown again as its redacted event" */
    it("shows the prompt once, with its text", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          recoveredCodexTurn({
            atMs: 1_000,
            messages: [
              { role: "system", content: "You are codex." },
              { role: "user", content: "echo papaya and tell me the output" },
            ],
            output: "It printed papaya.",
          }),
        ],
        logs: [redactedPromptEvent()],
      });

      const prompts = transcript.entries.filter((entry) => entry.kind === "user_prompt");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({
        text: "echo papaya and tell me the output",
      });
    });

    /** @scenario "A prompt recovered from the transcript is not shown again as its redacted event" */
    it("keeps the redacted event when no conversation was recovered", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [redactedPromptEvent()],
      });

      const prompts = transcript.entries.filter((entry) => entry.kind === "user_prompt");
      expect(prompts).toHaveLength(1);
      // The sentinel stays visible (it is the only record a prompt happened)
      // and the chars are the prompt's real length, not the sentinel's.
      expect(prompts[0]).toMatchObject({ text: "[REDACTED]", chars: 34 });
    });
  });

  describe("when the rollout recovered only one turn of two", () => {
    /** @scenario "A redacted prompt with no recovered turn behind it is kept" */
    it("keeps the stub of the turn it did not recover", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          recoveredCodexTurn({
            atMs: 1_000,
            messages: [
              { role: "system", content: "You are codex." },
              { role: "user", content: "echo papaya and tell me the output" },
            ],
            output: "It printed papaya.",
          }),
        ],
        logs: [
          redactedPromptEvent(),
          // A second turn, of a different length, whose conversation never
          // made it back. Suppressing it on a trace-wide flag would erase the
          // only record that this prompt happened.
          log(
            {
              "event.name": "codex.user_prompt",
              prompt: "[REDACTED]",
              prompt_length: "11",
              "conversation.id": "conv-1",
            },
            2_042,
          ),
        ],
      });

      const prompts = transcript.entries.filter((entry) => entry.kind === "user_prompt");
      expect(prompts).toHaveLength(2);
      expect(prompts.map((entry) => entry.text)).toEqual([
        "echo papaya and tell me the output",
        "[REDACTED]",
      ]);
      expect(prompts[1]).toMatchObject({ chars: 11 });
    });
  });

  describe("when two prompts are the same length and only the later one was recovered", () => {
    /** @scenario "A redacted prompt with no recovered turn behind it is kept" */
    it("keeps the earlier stub and does not show the recovered turn twice", () => {
      // Both turns typed a 24-character prompt, so the length alone cannot say
      // which turn the recovered conversation belongs to. Suppressing the
      // first stub would delete the turn that was never recovered.
      const later = "tell me about the second";
      expect(later).toHaveLength(24);

      const transcript = buildCodingAgentTranscript({
        spans: [
          recoveredCodexTurn({
            atMs: 5_000,
            messages: [{ role: "user", content: later }],
            output: "the second one.",
          }),
        ],
        logs: [
          log(
            {
              "event.name": "codex.user_prompt",
              prompt: "[REDACTED]",
              prompt_length: "24",
              "conversation.id": "conv-1",
            },
            1_042,
          ),
          log(
            {
              "event.name": "codex.user_prompt",
              prompt: "[REDACTED]",
              prompt_length: "24",
              "conversation.id": "conv-1",
            },
            5_042,
          ),
        ],
      });

      const prompts = transcript.entries.filter((entry) => entry.kind === "user_prompt");
      expect(prompts).toHaveLength(2);
      // The unrecovered turn keeps its stub, in its own place in time, and the
      // recovered turn is shown once with its words.
      expect(prompts.map((entry) => entry.text)).toEqual(["[REDACTED]", later]);
      expect(prompts[0]).toMatchObject({ atMs: 1_042 });
    });
  });

  describe("when the recovered turn's own prompt event never arrived", () => {
    /** @scenario "A redacted prompt with no recovered turn behind it is kept" */
    it("leaves an older stub of the same length alone", () => {
      // The log read is capped, so a recovered turn can arrive with no event
      // of its own. Claiming the nearest same-length stub regardless of
      // distance would take the earlier turn's event and delete the only
      // record of it.
      const prompt = "tell me about the second";
      // The stub below is the same length on purpose, so what rejects it is
      // the distance and not the length. A prompt of any other size would
      // pass this test through the check it is not about.
      expect(prompt).toHaveLength(24);

      const transcript = buildCodingAgentTranscript({
        spans: [
          recoveredCodexTurn({
            atMs: 600_000,
            messages: [{ role: "user", content: prompt }],
            output: "the second one.",
          }),
        ],
        logs: [
          log(
            {
              "event.name": "codex.user_prompt",
              prompt: "[REDACTED]",
              prompt_length: "24",
              "conversation.id": "conv-1",
            },
            1_042,
          ),
        ],
      });

      const prompts = transcript.entries.filter((entry) => entry.kind === "user_prompt");
      // Both survive: the old turn keeps its record, and the recovered turn
      // is shown with its words.
      expect(prompts.map((entry) => entry.text)).toEqual(["[REDACTED]", prompt]);
    });
  });
});

describe("given a prompt pasting tens of thousands of unclosed tags", () => {
  describe("when the session transcript is derived", () => {
    /** @scenario "A prompt full of unclosed tags is read without stalling the server" */
    it("derives the transcript in well under a tenth of a second", () => {
      // 63,999 characters, every tag unclosed, right at the size the
      // injected-context test still considers: the shape that costs a
      // backtracking tag match one scan to end-of-string per tag. The bound is
      // loose by two orders of magnitude on purpose. What it pins is the
      // scanner's algorithmic class, not a microbenchmark, so it holds on a
      // loaded CI box.
      const pasted = "<a>".repeat(21_333);
      const span = recoveredCodexTurn({
        atMs: 1_000,
        messages: [{ role: "user", content: pasted }],
        output: "noted",
      });

      const startedAtMs = performance.now();
      const transcript = buildCodingAgentTranscript({
        spans: [span],
        logs: [],
      });
      const elapsedMs = performance.now() - startedAtMs;

      expect(elapsedMs).toBeLessThan(100);
      expect(transcript.entries.find((entry) => entry.kind === "user_prompt")).toMatchObject({
        text: pasted,
      });
    });
  });
});

/**
 * Whether a message is nothing but tags, spelled the way the transcript's tag
 * strip was first written: a backreference with a lazy body. It stands here as
 * the oracle the derivation's scanner is held to, and it runs only over the
 * few-hundred-character shapes below.
 */
function isTagsOnlyByBacktrackingStrip(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("<")) return false;
  if (trimmed.length > 64_000) return false;
  return trimmed.replace(/<([A-Za-z_][\w.-]*)(\s[^>]*)?>[\s\S]*?<\/\1>/g, "").trim().length === 0;
}

/**
 * Every tag shape this file already pins, plus the nesting, attribute and
 * unmatched-tag shapes a prompt routinely pastes: JSX, diffs, generics, and
 * envelopes that close in the wrong order.
 */
const TAG_SHAPES = [
  "<recommended_plugins>\n- Airtable\n- Asana\n</recommended_plugins>\n<environment_context>\n<shell>zsh</shell>\n</environment_context>",
  "<environment_context>\n<cwd>/tmp</cwd>\n</environment_context>",
  "<system-reminder>\n# claudeMd\nContents of CLAUDE.md: always use pnpm.\n</system-reminder>\n\nRead hello.py and explain it",
  "<system-reminder>MCP tools: grafana</system-reminder>\n\nhi",
  "echo papaya and tell me the output",
  "just a question",
  "<a><a></a></a>",
  "<a></b></a>",
  '<a b="1">x</a>',
  "<a x=<y>z</a>",
  "<div><p>hi</p></div>",
  "<a>unclosed <b>deep</b>",
  "<a><b></a></b>",
  "<a>x</a>\n<b>y</b>",
  "<a/>",
  "< a></a>",
  "<1a></1a>",
  "<A></a>",
  "if (a < b && c < d) return;",
  "<T>x</T> and Vec<T>",
  "<a>",
];

describe("given the tag shapes a recovered prompt can carry", () => {
  describe("when the session transcript is derived", () => {
    /** @scenario "Context the agent injected under the user's name is not shown as their prompt" */
    it("tells context from prose exactly as the tag strip always has", () => {
      for (const content of TAG_SHAPES) {
        const transcript = buildCodingAgentTranscript({
          spans: [
            recoveredCodexTurn({
              atMs: 1_000,
              messages: [{ role: "user", content }],
              output: "ok",
            }),
          ],
          logs: [],
        });
        const prompts = transcript.entries.filter((entry) => entry.kind === "user_prompt");

        expect({ content, prompts: prompts.length }).toEqual({
          content,
          prompts: isTagsOnlyByBacktrackingStrip(content) ? 0 : 1,
        });
      }
    });
  });
});

describe("given a recovered reply longer than the producer writes to the span", () => {
  describe("when the next turn replays", () => {
    it("does not render that reply a second time just because it was truncated", () => {
      const longReply = `${"x".repeat(5_000)} tail`;
      const truncatedOnSpan = `${longReply.slice(0, 4_000)}…[truncated]`;
      const first = [
        { role: "system", content: "You are codex." },
        { role: "user", content: "ask" },
      ];

      const transcript = buildCodingAgentTranscript({
        spans: [
          recoveredCodexTurn({
            atMs: 1_000,
            messages: first,
            output: truncatedOnSpan,
            spanId: "codex-io-1",
          }),
          recoveredCodexTurn({
            atMs: 2_000,
            messages: [
              ...first,
              { role: "assistant", content: longReply },
              { role: "user", content: "again" },
            ],
            output: "second answer",
            spanId: "codex-io-2",
          }),
        ],
        logs: [],
      });

      const replies = transcript.entries.filter((e) => e.kind === "assistant_message");
      expect(
        replies.filter((r) => r.kind === "assistant_message" && r.text === longReply),
      ).toHaveLength(0);
    });
  });
});
