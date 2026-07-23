/**
 * The coding-agent transcript, derived on the SERVER.
 *
 * These pin the two properties that made it worth moving off the client: the
 * transcript is ordered by what actually happened (not by which exporter arrived
 * first), and it includes the moments that have NO span — a tool the human
 * refused never runs, so the logs are the only place it exists.
 */
import { describe, expect, it } from "vitest";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import {
  buildCodingAgentTranscript,
  type TranscriptLogRecord,
} from "../coding-agent-transcript.derivation";

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

function modelSpan({
  atMs,
  cost = 0.5,
}: {
  atMs: number;
  cost?: number;
}): SpanDetail {
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

function log(
  attributes: Record<string, unknown>,
  timestampMs: number,
): TranscriptLogRecord {
  return { timestampMs, attributes };
}

describe("buildCodingAgentTranscript", () => {
  describe("given a session's spans and logs", () => {
    it("tells the story in the order it happened, across BOTH streams", () => {
      // Spans and logs arrive on separate exporters and separate batches, so the
      // order they are handed to us says nothing about what happened first.
      const transcript = buildCodingAgentTranscript({
        spans: [
          toolSpan({ name: "Bash", atMs: 3_000 }),
          modelSpan({ atMs: 2_000 }),
        ],
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
      expect(transcript.subAgents).toEqual([
        { agentId: "agent-7", toolCalls: 2 },
      ]);
      expect(transcript.totals.toolCalls).toBe(3);
    });
  });

  describe("given an MCP tool", () => {
    it("names the server it came from", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [
          toolSpan({ name: "mcp__claude-in-chrome__navigate", atMs: 1_000 }),
        ],
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

      expect(transcript.entries).toMatchObject([
        { kind: "tool", name: "search_docs" },
      ]);
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
      expect(
        transcript.entries.filter((entry) => entry.kind === "tool"),
      ).toHaveLength(1);
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
          log(
            { "event.name": "claude_code.skill_activated", skill_name: "pdf" },
            4_000,
          ),
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
            candidates: [
              { content: { parts: [{ text: '{"complexity":"trivial"}' }] } },
            ],
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

      const replies = transcript.entries.filter(
        (entry) => entry.kind === "assistant_message",
      );
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({
        text: "pong",
        model: "gemini-3.5-flash",
      });
      expect(JSON.stringify(transcript.entries)).not.toContain(
        "Thinking it over",
      );
      expect(JSON.stringify(transcript.entries)).not.toContain("complexity");
    });

    it("derives the user prompt, the tool call, and the model call", () => {
      const transcript = buildCodingAgentTranscript({ spans, logs });

      expect(
        transcript.entries.find((entry) => entry.kind === "user_prompt"),
      ).toMatchObject({ text: "reply with the single word pong" });
      expect(
        transcript.entries.find((entry) => entry.kind === "tool"),
      ).toMatchObject({ name: "read_file", durationMs: 42, failed: false });
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

      const replies = transcript.entries.filter(
        (entry) => entry.kind === "assistant_message",
      );
      expect(replies.map((reply) => reply.text)).toEqual([
        "pong",
        "second answer",
      ]);
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
      const call = transcript.entries.find(
        (entry) => entry.kind === "model_call",
      );
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
      expect(
        transcript.entries.find((entry) => entry.kind === "assistant_message"),
      ).toMatchObject({ text: "pong" });
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
