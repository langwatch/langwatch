import { describe, expect, it } from "vitest";
import type { TraceListItem } from "../../../../types/trace";
import { buildTerminalSteps } from "../buildTerminalSteps";

function trace(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 1_000,
    name: "turn",
    serviceName: "claude-code",
    durationMs: 10,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: ["claude-sonnet-4"],
    labels: [],
    status: "ok",
    spanCount: 1,
    sizeBytes: 0,
    input: null,
    output: null,
    origin: "coding_agent",
    evaluations: [],
    events: [],
    ...over,
  };
}

const firstInput = JSON.stringify([
  { role: "system", content: "You are Claude Code." },
  { role: "user", content: "check git status" },
]);
const firstOutput = JSON.stringify([
  {
    role: "assistant",
    content: [
      { type: "text", text: "Checking the working tree." },
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "git status" } },
    ],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: "On branch main" }],
  },
]);

describe("buildTerminalSteps", () => {
  describe("given a single coding-agent trace with a system prompt", () => {
    const steps = buildTerminalSteps([
      trace({
        input: firstInput,
        output: firstOutput,
        totalTokens: 120,
        totalCost: 0.02,
      }),
    ]);

    it("orders the beats system then user then assistant", () => {
      expect(steps.map((s) => s.turn.kind)).toEqual([
        "system",
        "user",
        "assistant",
      ]);
    });

    it("folds the tool call and its result into the assistant beat", () => {
      const assistant = steps[2]!;
      if (assistant.turn.kind !== "assistant") throw new Error("not assistant");
      const kinds = assistant.turn.blocks.map((b) => b.kind);
      expect(kinds).toContain("tool_use");
      expect(kinds).toContain("tool_result");
    });

    it("attributes tokens and cost only to the assistant beat", () => {
      expect(steps[0]!.tokens).toBeUndefined();
      expect(steps[1]!.tokens).toBeUndefined();
      expect(steps[2]!.tokens).toBe(120);
      expect(steps[2]!.costUsd).toBe(0.02);
    });
  });

  describe("given multiple traces in the conversation", () => {
    const secondInput = JSON.stringify([
      { role: "system", content: "You are Claude Code." },
      { role: "user", content: "check git status" },
      { role: "assistant", content: "Checked." },
      { role: "user", content: "now bump the version" },
    ]);
    const secondOutput = JSON.stringify([
      { role: "assistant", content: "Bumped to 2.0.0." },
    ]);

    const steps = buildTerminalSteps([
      trace({
        traceId: "a",
        input: firstInput,
        output: firstOutput,
        totalTokens: 100,
        totalCost: 0.01,
      }),
      trace({
        traceId: "b",
        timestamp: 2_000,
        input: secondInput,
        output: secondOutput,
        totalTokens: 50,
        totalCost: 0.005,
      }),
    ]);

    it("surfaces the system prompt once, from the opening trace", () => {
      const systemBeats = steps.filter((s) => s.turn.kind === "system");
      expect(systemBeats).toHaveLength(1);
    });

    it("counts each trace's tokens exactly once", () => {
      const attributed = steps
        .map((s) => s.tokens)
        .filter((t): t is number => t != null);
      expect(attributed).toEqual([100, 50]);
    });

    it("keeps the second turn's prompt and response", () => {
      const userTexts = steps
        .filter((s) => s.turn.kind === "user")
        .flatMap((s) =>
          s.turn.blocks.flatMap((b) => (b.kind === "text" ? [b.text] : [])),
        );
      expect(userTexts).toContain("now bump the version");
    });
  });

  describe("given output that is not chat-shaped", () => {
    it("keeps the raw output as an assistant beat", () => {
      const steps = buildTerminalSteps([
        trace({
          input: JSON.stringify([{ role: "user", content: "hello" }]),
          output: "just a plain string reply",
        }),
      ]);
      const assistant = steps.find((s) => s.turn.kind === "assistant");
      expect(assistant).toBeDefined();
      if (assistant?.turn.kind !== "assistant") throw new Error("no assistant");
      expect(
        assistant.turn.blocks.some(
          (b) => b.kind === "text" && b.text === "just a plain string reply",
        ),
      ).toBe(true);
    });
  });
});
