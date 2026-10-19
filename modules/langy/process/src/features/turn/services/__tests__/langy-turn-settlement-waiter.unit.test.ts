import {
  LANGY_CONVERSATION_TURN_STATUS,
  LangyConversationNotFoundError,
  type LangyConversationTurnData,
  type LangyTurnToolCall,
} from "@langwatch/langy-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LangyTurnSettlementWaiterService } from "../langy-turn-settlement-waiter.service.ts";

const mockFindTurn = vi.fn();
const mockDisconnect = vi.fn();
const mockReadTail = vi.fn();
const mockFollow = vi.fn();

const awaitTurnSettlement: ReturnType<
  typeof LangyTurnSettlementWaiterService.create
>["awaitTurnSettlement"] = (input) =>
  LangyTurnSettlementWaiterService.create().awaitTurnSettlement(input);

function turn(overrides: Partial<LangyConversationTurnData> = {}): LangyConversationTurnData {
  return {
    ConversationId: "conv-1",
    TurnId: "turn-1",
    Status: LANGY_CONVERSATION_TURN_STATUS.RUNNING,
    QuestionParts: [],
    AnswerParts: [],
    ToolCalls: [],
    Plan: null,
    Error: null,
    StartedAt: 1,
    EndedAt: null,
    CreatedAt: 1,
    UpdatedAt: 1,
    LastEventOccurredAt: 1,
    ...overrides,
  };
}

const runningTurn = turn();
const completedTurn = turn({
  Status: LANGY_CONVERSATION_TURN_STATUS.COMPLETED,
  AnswerParts: [{ type: "text", text: "from the projection" }],
  EndedAt: 2,
});

const settledAnswer = {
  succeeded: true,
  outcome: "completed",
  text: "from the projection",
  messageId: "langymsg_turn-turn-1",
  parts: [{ type: "text", text: "from the projection" }],
  error: null,
};

const args = {
  langy: { findTurn: mockFindTurn },
  openBuffer: () => ({
    buffer: { readTail: mockReadTail, follow: mockFollow } as never,
    release: mockDisconnect,
  }),
  projectId: "project-1",
  conversationId: "conv-1",
  turnId: "turn-1",
  userId: "user-1",
};

describe("awaitTurnSettlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadTail.mockResolvedValue({ reads: [], lastId: "0" });
  });

  /** @scenario "A held turn settles from the turn-state projection" */
  it("settles from the turn projection once it records the reply", async () => {
    mockFindTurn.mockResolvedValueOnce([runningTurn]).mockResolvedValue([completedTurn]);
    mockFollow.mockImplementation(async function* () {
      yield { id: "1-1", entry: { type: "end" } };
    });

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toEqual({
      kind: "settled",
      settlement: settledAnswer,
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("gives a card-only turn the code access line instead of an empty reply", async () => {
    const parts = [{ type: "tool-code_access" }];
    mockFindTurn.mockResolvedValue([{ ...completedTurn, AnswerParts: parts }]);

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toMatchObject({
      kind: "settled",
      settlement: {
        text: "I'm waiting for you to say how I should reach your code, on the card above.",
        parts,
      },
    });
  });

  /** @scenario "A settled turn answers its message id and parts" */
  it("hands back the answer's message id and its parts beside its text", async () => {
    mockFindTurn.mockResolvedValue([completedTurn]);

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toEqual({
      kind: "settled",
      settlement: {
        succeeded: true,
        outcome: "completed",
        text: "from the projection",
        messageId: "langymsg_turn-turn-1",
        parts: [{ type: "text", text: "from the projection" }],
        error: null,
      },
    });
  });

  /** @scenario "A wait is satisfied only by the turn this request started" */
  it("reads only the turn this request started, keeping waiting until it settles", async () => {
    mockFindTurn.mockResolvedValueOnce([]).mockResolvedValue([completedTurn]);

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toMatchObject({ kind: "settled", settlement: { succeeded: true } });
    expect(mockFindTurn).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conv-1",
      turnId: "turn-1",
      userId: "user-1",
    });
  });

  it("answers a failed turn with its error", async () => {
    mockFindTurn.mockResolvedValue([
      turn({ Status: LANGY_CONVERSATION_TURN_STATUS.FAILED, Error: "agent unreachable" }),
    ]);

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toEqual({
      kind: "settled",
      settlement: { succeeded: false, outcome: "failed", text: null, error: "agent unreachable" },
    });
  });

  it("stops on abort, and an unseen conversation never settles", async () => {
    mockFindTurn.mockRejectedValue(new LangyConversationNotFoundError("conv-1"));
    mockFollow.mockImplementation(async function* (input: { signal: AbortSignal }) {
      await new Promise((resolve) =>
        input.signal.addEventListener("abort", resolve, { once: true }),
      );
      yield* [];
    });

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(50),
      pollIntervalMs: 5,
    });

    expect(settlement).toEqual({ kind: "stopped" });
    expect(mockDisconnect).toHaveBeenCalled();
  });
});

describe("awaitTurnSettlement (user wait)", () => {
  const waitingCall: LangyTurnToolCall = {
    toolCallId: "call-1",
    toolName: "question",
    status: "initiated",
    wait: {
      waitId: "wait-1",
      kind: "question",
      status: "pending",
      expiresAt: 600_000,
      callId: null,
      summary: null,
      pattern: null,
      patterns: [],
      reason: null,
      timeoutSeconds: null,
      skipOffered: false,
      workspaceName: null,
      hostname: null,
      questions: [
        { question: "What would you like to do?", options: [] },
        { question: "Which project?", options: [] },
      ],
      decision: null,
      source: null,
      answers: null,
      answeredBy: null,
      answeredAt: null,
    },
  };
  const waitingTurn = turn({ ToolCalls: [waitingCall] });

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadTail.mockResolvedValue({ reads: [], lastId: "0" });
    mockFollow.mockImplementation(async function* (opts: { signal: AbortSignal }) {
      await new Promise((resolve) =>
        opts.signal.addEventListener("abort", resolve, { once: true }),
      );
      yield* [];
    });
  });

  describe("given a turn whose projection holds a pending question card and no reply", () => {
    /** @scenario "A user wait settles the wait only when the caller opts in" */
    it("settles as awaiting_user carrying the question text when the caller opted in", async () => {
      mockFindTurn.mockResolvedValue([waitingTurn]);

      const settlement = await awaitTurnSettlement({
        ...args,
        signal: AbortSignal.timeout(5_000),
        pollIntervalMs: 5,
        shouldSettleOnUserWait: true,
      });

      expect(settlement).toEqual({
        kind: "awaiting_user",
        question: "What would you like to do?\nWhich project?",
      });
    });

    /** @scenario "A user wait keeps a caller that did not opt in waiting" */
    it("keeps a caller that did not opt in waiting until its signal aborts", async () => {
      mockFindTurn.mockResolvedValue([waitingTurn]);

      const settlement = await awaitTurnSettlement({
        ...args,
        signal: AbortSignal.timeout(50),
        pollIntervalMs: 5,
      });

      expect(settlement).toEqual({ kind: "stopped" });
    });
  });

  describe("given a turn whose projection holds both a question card and a completed reply", () => {
    /** @scenario "A reply in the fold wins over a user wait" */
    it("settles as the completed reply", async () => {
      mockFindTurn.mockResolvedValue([{ ...completedTurn, ToolCalls: [waitingCall] }]);

      const settlement = await awaitTurnSettlement({
        ...args,
        signal: AbortSignal.timeout(5_000),
        pollIntervalMs: 5,
        shouldSettleOnUserWait: true,
      });

      expect(settlement).toEqual({
        kind: "settled",
        settlement: settledAnswer,
      });
    });
  });
});
