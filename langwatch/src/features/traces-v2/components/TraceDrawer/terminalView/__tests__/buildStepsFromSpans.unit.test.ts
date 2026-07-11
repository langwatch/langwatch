import { describe, expect, it } from "vitest";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import { buildTerminalStepsFromSpans } from "../buildStepsFromSpans";

/**
 * A Claude Code turn is an agentic loop: call the model, run a tool, call the
 * model again with the result. Each model call is its own `llm_request` span
 * carrying the ROLLING history, so the last call's input holds the whole turn.
 */
function llmRequestSpan({
  spanId,
  startTimeMs,
  input,
  output,
  promptTokens = 0,
  completionTokens = 0,
  cost = 0,
}: {
  spanId: string;
  startTimeMs: number;
  input?: unknown;
  output?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}): SpanDetail {
  return {
    spanId,
    parentSpanId: null,
    name: "claude_code.llm_request",
    type: "llm",
    startTimeMs,
    endTimeMs: startTimeMs + 1000,
    durationMs: 1000,
    status: "ok",
    model: "claude-opus-4-8[1m]",
    input: input === undefined ? null : JSON.stringify(input),
    output: output ?? null,
    metrics: { promptTokens, completionTokens, cost },
    params: {},
    events: [],
  } as unknown as SpanDetail;
}

/** The rolling history as it stands on the FINAL call of a one-tool turn. */
const FINAL_HISTORY = [
  { role: "user", content: "fix the failing test" },
  {
    role: "assistant",
    content: [
      { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pnpm test" } },
    ],
  },
  {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "toolu_1", content: "1 failed" },
    ],
  },
];

describe("buildTerminalStepsFromSpans", () => {
  describe("given a turn whose model was called twice around a tool run", () => {
    const spans = [
      llmRequestSpan({
        spanId: "call-2",
        startTimeMs: 2000,
        input: FINAL_HISTORY,
        output: "Fixed it.",
        promptTokens: 900,
        completionTokens: 20,
        cost: 0.03,
      }),
      llmRequestSpan({
        spanId: "call-1",
        startTimeMs: 1000,
        input: [{ role: "user", content: "fix the failing test" }],
        promptTokens: 100,
        completionTokens: 10,
        cost: 0.01,
      }),
    ];

    it("reconstructs the turn from the final call, keeping the tool call and its result", () => {
      const steps = buildTerminalStepsFromSpans(spans);

      const kinds = steps.map((s) => s.turn.kind);
      expect(kinds).toContain("user");
      expect(kinds).toContain("assistant");

      const blocks = steps.flatMap((s) => s.turn.blocks);
      expect(blocks.some((b) => b.kind === "tool_use")).toBe(true);
      expect(blocks.some((b) => b.kind === "tool_result")).toBe(true);
    });

    it("sums tokens and cost across the WHOLE loop, not just its last hop", () => {
      const steps = buildTerminalStepsFromSpans(spans);

      // 100 + 10 + 900 + 20, and 0.01 + 0.03 — attributed to the closing beat
      // so the timeline HUD counts the turn exactly once.
      expect(steps.at(-1)?.tokens).toBe(1030);
      expect(steps.at(-1)?.costUsd).toBeCloseTo(0.04);
    });
  });

  describe("given no llm_request spans", () => {
    it("returns no steps rather than inventing a session", () => {
      const toolSpan = {
        ...llmRequestSpan({ spanId: "t", startTimeMs: 1 }),
        name: "claude_code.tool",
      } as SpanDetail;

      expect(buildTerminalStepsFromSpans([toolSpan])).toEqual([]);
      expect(buildTerminalStepsFromSpans([])).toEqual([]);
    });
  });

  describe("given a model call whose content never arrived", () => {
    it("returns no steps rather than an empty shell", () => {
      const steps = buildTerminalStepsFromSpans([
        llmRequestSpan({ spanId: "call-1", startTimeMs: 1000 }),
      ]);

      expect(steps).toEqual([]);
    });
  });
});

/**
 * A Claude Code turn can spawn sub-agents (the Agent/Task tool), each running
 * its OWN conversation with its own rolling history. "The last model call
 * carries the whole turn" therefore holds per AGENT, not per trace — reading the
 * trace's last llm_request would hand back a sub-agent's transcript and pass it
 * off as the turn.
 */
describe("given a turn that spawned a sub-agent", () => {
  it("renders the MAIN thread's transcript, not the sub-agent's", () => {
    const mainCall = llmRequestSpan({
      spanId: "main-1",
      startTimeMs: 1000,
      input: [{ role: "user", content: "fix the failing test" }],
      output: "Fixed it.",
    });
    // The sub-agent's call finishes LAST, so a per-trace "final call" wins here.
    const subAgentCall = {
      ...llmRequestSpan({
        spanId: "sub-1",
        startTimeMs: 5000,
        input: [{ role: "user", content: "search the codebase for foo" }],
        output: "Found foo in bar.ts",
      }),
      params: { agent_id: "agent_abc" },
    } as SpanDetail;

    const steps = buildTerminalStepsFromSpans([mainCall, subAgentCall]);

    const text = steps
      .flatMap((s) => s.turn.blocks)
      .map((b) => ("text" in b ? b.text : ""))
      .join(" ");
    expect(text).toContain("fix the failing test");
    expect(text).not.toContain("search the codebase for foo");
  });
});
