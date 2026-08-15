import { describe, expect, it } from "vitest";
import type { TraceListItem } from "~/server/app-layer/traces/trace-list.service";
import { toConversationContextTurn } from "../tracesV2";

function listItem(overrides: Partial<TraceListItem> = {}): TraceListItem {
  return {
    traceId: "trace-1",
    timestamp: 1_000,
    name: "root span",
    serviceName: "claude-code",
    durationMs: 4_000,
    totalCost: 0.42,
    nonBilledCost: 0,
    totalTokens: 1_234,
    inputTokens: 1_000,
    outputTokens: 234,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    reasoningTokens: null,
    contextSizeTokens: null,
    models: ["claude-opus-5"],
    labels: [],
    promptId: null,
    promptVersionNumber: null,
    status: "ok",
    spanCount: 3,
    sizeBytes: 0,
    input: "bump the version",
    output: "Bumped.",
    error: null,
    conversationId: "session-a",
    userId: null,
    origin: "coding_agent",
    tokensEstimated: false,
    ttft: null,
    traceName: "claude_code.turn",
    rootSpanType: "agent",
    ...overrides,
  };
}

const seeEverything = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

describe("toConversationContextTurn", () => {
  describe("given a listed turn of a session", () => {
    /** @scenario "The turn list carries each turn's cost and tokens" */
    it("carries the turn's total tokens and total cost", () => {
      const turn = toConversationContextTurn(listItem(), seeEverything);

      expect(turn.totalTokens).toBe(1_234);
      expect(turn.totalCost).toBe(0.42);
    });

    it("keeps the turn's identity and content", () => {
      const turn = toConversationContextTurn(listItem(), seeEverything);

      expect(turn.traceId).toBe("trace-1");
      expect(turn.timestamp).toBe(1_000);
      expect(turn.name).toBe("claude_code.turn");
      expect(turn.input).toBe("bump the version");
      expect(turn.output).toBe("Bumped.");
    });
  });

  describe("given the viewer may not see captured content", () => {
    it("nulls the content but still carries the totals", () => {
      const turn = toConversationContextTurn(listItem(), {
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        capturedInputVisibleTo: "Admins",
        capturedOutputVisibleTo: "Admins",
      });

      expect(turn.input).toBeNull();
      expect(turn.output).toBeNull();
      expect(turn.inputRedacted).toBe(true);
      expect(turn.outputRedacted).toBe(true);
      expect(turn.totalTokens).toBe(1_234);
      expect(turn.totalCost).toBe(0.42);
    });
  });
});
