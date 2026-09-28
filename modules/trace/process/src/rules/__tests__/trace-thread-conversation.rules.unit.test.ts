import type { ChatMessage, Span, Trace } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { extractConversationSteps } from "../trace-conversation-steps.rules.ts";
import { renderThreadConversation } from "../trace-thread-conversation.rules.ts";

const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);

function span(overrides: Partial<Span> & Pick<Span, "span_id" | "type">): Span {
  return {
    trace_id: "trace",
    name: overrides.type,
    parent_id: "root",
    timestamps: { started_at: T0, finished_at: T0 + 100 },
    input: null,
    output: null,
    error: null,
    metrics: null,
    params: null,
    ...overrides,
  } as Span;
}

/** One agent turn: a model call that asks for a tool, the tool, and a model call that replies. */
function agentTurn({
  index,
  user,
  reply,
  history,
  tool,
}: {
  index: number;
  user: string;
  reply: string;
  history: ChatMessage[];
  tool?: { name: string; args: object; result: object };
}): Trace {
  const at = T0 + index * 60_000;
  const traceId = `trace-${index}`;
  const input: ChatMessage[] = [...history, { role: "user", content: user }];
  const spans: Span[] = [
    span({
      span_id: `root-${index}`,
      parent_id: null,
      type: "agent",
      name: "agent.run",
      trace_id: traceId,
    }),
  ];
  if (tool) {
    spans.push(
      span({
        span_id: `ask-${index}`,
        parent_id: `root-${index}`,
        trace_id: traceId,
        type: "llm",
        model: "gpt-5-mini",
        timestamps: { started_at: at + 10, finished_at: at + 500 },
        input: { type: "chat_messages", value: input },
        output: {
          type: "chat_messages",
          value: [
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: tool.name, arguments: JSON.stringify(tool.args) },
                },
              ],
            },
          ],
        },
        metrics: { prompt_tokens: 580, completion_tokens: 24 },
      }),
      span({
        span_id: `tool-${index}`,
        parent_id: `root-${index}`,
        trace_id: traceId,
        type: "tool",
        name: `execute_tool ${tool.name}`,
        timestamps: { started_at: at + 600, finished_at: at + 900 },
        input: { type: "json", value: tool.args },
        output: { type: "json", value: tool.result },
        params: { gen_ai: { tool: { name: tool.name } } },
      }),
    );
  }
  spans.push(
    span({
      span_id: `reply-${index}`,
      parent_id: `root-${index}`,
      trace_id: traceId,
      type: "llm",
      model: "gpt-5-mini",
      timestamps: { started_at: at + 1_000, finished_at: at + 2_000 },
      input: { type: "chat_messages", value: input },
      output: { type: "chat_messages", value: [{ role: "assistant", content: reply }] },
      metrics: { prompt_tokens: 940, completion_tokens: 8 },
    }),
  );
  return {
    trace_id: traceId,
    project_id: "project-1",
    metadata: { thread_id: "thread-1" },
    timestamps: { started_at: at, inserted_at: at, updated_at: at },
    input: { value: user },
    output: { value: reply },
    metrics: { total_time_ms: 2_000 },
    spans,
  };
}

/** A thread of `turns` turns, each model call carrying the whole history before it. */
function thread({
  turns,
  toolAt = new Map(),
  replyPadding = "",
}: {
  turns: number;
  toolAt?: Map<number, { name: string; args: object; result: object }>;
  replyPadding?: string;
}): Trace[] {
  const history: ChatMessage[] = [];
  const traces: Trace[] = [];
  for (let index = 0; index < turns; index++) {
    const user = `Question ${index}: tell me about activity ${index} at the park.`;
    const reply = `Activity ${index} runs every day. ${replyPadding}`.trim();
    const tool = toolAt.get(index);
    traces.push(agentTurn({ index, user, reply, history: [...history], tool }));
    history.push({ role: "user", content: user }, { role: "assistant", content: reply });
  }
  return traces;
}

const QUOTE = {
  name: "get_quote",
  args: { unit: "C-114", week: "2026-W42" },
  result: { unit: "C-114", total_eur: 1387.5, nights: 7 },
};

describe("renderThreadConversation", () => {
  describe("given a thread whose first turn called a tool that returned a price", () => {
    /** @scenario "A conversation turn lists its tool calls with their results" */
    it("lists the tool call with its arguments and result, and the model call that asked for it", () => {
      const text = renderThreadConversation({
        threadKey: "thread-1",
        traces: thread({ turns: 3, toolAt: new Map([[0, QUOTE]]) }),
      }).text;

      expect(text).toContain('tool get_quote({"unit":"C-114","week":"2026-W42"})');
      expect(text).toContain('"total_eur":1387.5');
      expect(text).toContain("model gpt-5-mini (in 580, out 24) → get_quote");
      expect(text.indexOf("get_quote")).toBeLessThan(text.indexOf("## Turn 2"));
    });
  });

  describe("given a thread whose every model call carries the whole history", () => {
    /** @scenario "A thread transcript grows with the thread, not with its square" */
    it("prints the first user message once and grows linearly", () => {
      const tokensOf = (turns: number) =>
        renderThreadConversation({ threadKey: "thread-1", traces: thread({ turns }) })
          .estimatedTokens;
      const text = renderThreadConversation({
        threadKey: "thread-1",
        traces: thread({ turns: 40 }),
      }).text;

      expect(text.split("Question 0: tell me about activity 0").length - 1).toBe(1);
      expect(tokensOf(80) / tokensOf(40)).toBeLessThan(2.2);
    });
  });

  describe("given a chat turn with one model call whose output is the reply", () => {
    /** @scenario "A turn whose only step is the model call that wrote the reply lists no steps" */
    it("shows the user message and the reply with no step list", () => {
      const text = renderThreadConversation({
        threadKey: "thread-1",
        traces: thread({ turns: 2 }),
      }).text;

      expect(text).not.toContain("**Steps:**");
      expect(text).toContain("Activity 1 runs every day.");
    });
  });

  describe("given a long thread whose correction sits in a tool result in the middle", () => {
    /** @scenario "A conversation over the budget shortens every turn before it drops one" */
    it("keeps every turn and the correction, shortened to the budget", () => {
      const correction = {
        name: "get_quote",
        args: { unit: "C-114", week: "2026-W42", revision: 2 },
        result: { unit: "C-114", total_eur: 1212, nights: 7, note: "corrected price" },
      };
      const traces = thread({
        turns: 41,
        toolAt: new Map([
          [0, QUOTE],
          [20, correction],
        ]),
        replyPadding: "The schedule and the age limits are described at the reception. ".repeat(12),
      });
      const whole = renderThreadConversation({ threadKey: "thread-1", traces });
      const budget = Math.floor(whole.estimatedTokens * 0.5);

      const cut = renderThreadConversation({ threadKey: "thread-1", traces, maxTokens: budget });

      expect(cut.isTruncated).toBe(true);
      expect(cut.omittedTurns).toBe(0);
      expect(cut.estimatedTokens).toBeLessThanOrEqual(budget);
      expect(cut.text).toContain('"total_eur":1212');
      expect(cut.text).toContain('"total_eur":1387.5');
      expect(cut.text).toContain("## Turn 21");
      expect(cut.text.match(/## Turn \d+/g)).toHaveLength(41);
    });
  });

  describe("given a coding agent turn whose first model call is a title call on a small model", () => {
    /** @scenario "The turn heading names the model that did the work" */
    it("names the model that wrote the most output first", () => {
      const coding: Trace = {
        ...agentTurn({ index: 0, user: "Run the cart tests.", reply: "All pass.", history: [] }),
      };
      coding.spans = [
        span({ span_id: "root-0", parent_id: null, type: "span", name: "claude_code.interaction" }),
        span({
          span_id: "title",
          type: "llm",
          model: "claude-haiku-4-5",
          output: { type: "text", value: '{"title":"Cart tests"}' },
          metrics: { completion_tokens: 150 },
        }),
        span({
          span_id: "main-1",
          type: "llm",
          model: "claude-opus-5",
          timestamps: { started_at: T0 + 50, finished_at: T0 + 100 },
          output: { type: "text", value: "[tool_use: Bash]\n{}" },
          metrics: { completion_tokens: 150 },
        }),
        span({
          span_id: "main-2",
          type: "llm",
          model: "claude-opus-5",
          timestamps: { started_at: T0 + 200, finished_at: T0 + 300 },
          output: { type: "text", value: "All pass." },
          metrics: { completion_tokens: 150 },
        }),
      ];

      const text = renderThreadConversation({ threadKey: "sess-1", traces: [coding] }).text;

      expect(text).toMatch(/## Turn 1 · [^·]+ · claude-opus-5 ·/);
    });
  });
});

describe("extractConversationSteps", () => {
  describe("given a tool span with execution and blocked-on-user children that repeat it", () => {
    /** @scenario "A child span that repeats its parent's input and output is folded into the parent" */
    it("lists the tool call once, and a differing child under it", () => {
      const io = {
        input: { type: "json" as const, value: { command: "pnpm test src/cart.test.ts" } },
        output: { type: "json" as const, value: { status: "completed", success: true } },
      };
      const params = { tool_name: "Bash", full_command: "pnpm test src/cart.test.ts" };
      const steps = extractConversationSteps({
        replyText: "All pass.",
        spans: [
          span({ span_id: "root", parent_id: null, type: "span", name: "claude_code.interaction" }),
          span({ span_id: "tool", type: "span", name: "claude_code.tool", params, ...io }),
          span({
            span_id: "exec",
            parent_id: "tool",
            type: "span",
            name: "claude_code.tool.execution",
            params,
            ...io,
          }),
          span({
            span_id: "wait",
            parent_id: "tool",
            type: "span",
            name: "claude_code.tool.blocked_on_user",
            params,
            ...io,
          }),
          span({
            span_id: "db",
            parent_id: "tool",
            type: "span",
            name: "db.query",
            input: { type: "text", value: "SELECT * FROM carts" },
            output: { type: "json", value: [{ id: 7 }] },
          }),
        ],
      });

      expect(steps.map((step) => [step.kind, step.name, step.depth])).toEqual([
        ["tool", "Bash", 0],
        ["span", "db.query", 1],
      ]);
    });
  });
});
