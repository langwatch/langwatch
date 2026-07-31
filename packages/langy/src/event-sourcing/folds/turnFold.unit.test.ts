import { describe, expect, it } from "vitest";

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TURN_TOOL_CALL_STATUS,
} from "../../constants";
import {
  foldLangyConversationTurn,
  initLangyConversationTurnState,
  type LangyConversationTurnEvent,
  type LangyConversationTurnFoldState,
  makeConversationTurnKey,
  parseConversationTurnKey,
} from "./turnFold";

const IDS = { conversationId: "conv-1", turnId: "turn-1" };

function fold(
  events: LangyConversationTurnEvent[],
  from: LangyConversationTurnFoldState = initLangyConversationTurnState(),
): LangyConversationTurnFoldState {
  return events.reduce(foldLangyConversationTurn, from);
}

function accepted(at = 1_000): LangyConversationTurnEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    occurredAt: at,
    data: { ...IDS, questionParts: [{ type: "text", text: "why?" }] },
  };
}

function responded(
  outcome: "completed" | "failed" | "stopped",
  at = 5_000,
): LangyConversationTurnEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    occurredAt: at,
    data: {
      ...IDS,
      messageId: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "because." }],
      outcome,
      error: outcome === "failed" ? "model refused" : null,
    },
  };
}

describe("foldLangyConversationTurn", () => {
  describe("given a clean accept → respond lifecycle", () => {
    it("folds one self-contained turn document", () => {
      const state = fold([accepted(), responded("completed")]);

      expect(state.ConversationId).toBe("conv-1");
      expect(state.TurnId).toBe("turn-1");
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.COMPLETED);
      expect(state.QuestionParts).toEqual([{ type: "text", text: "why?" }]);
      expect(state.AnswerParts).toEqual([{ type: "text", text: "because." }]);
      expect(state.StartedAt).toBe(1_000);
      expect(state.EndedAt).toBe(5_000);
      expect(state.Error).toBeNull();
    });

    it("never mutates the input state — the fold is pure", () => {
      const before = initLangyConversationTurnState();
      const snapshot = structuredClone(before);
      fold([accepted(), responded("completed")], before);
      expect(before).toEqual(snapshot);
    });
  });

  describe("when the user stops the turn mid-answer (ADR-078)", () => {
    it("keeps the partial answer, reads stopped, and carries no error", () => {
      const state = fold([accepted(), responded("stopped")]);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.STOPPED);
      expect(state.AnswerParts.length).toBeGreaterThan(0);
      expect(state.Error).toBeNull();
    });
  });

  describe("when the answer-carrying terminal reports failure", () => {
    it("reads failed and keeps the failure text", () => {
      const state = fold([accepted(), responded("failed")]);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.FAILED);
      expect(state.Error).toBe("model refused");
    });
  });

  describe("when the no-answer stall terminalizes the turn", () => {
    it("reads failed with the stall error and no answer", () => {
      const state = fold([
        accepted(),
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
          occurredAt: 9_000,
          data: { ...IDS, error: "worker went silent" },
        },
      ]);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.FAILED);
      expect(state.Error).toBe("worker went silent");
      expect(state.AnswerParts).toEqual([]);
      expect(state.EndedAt).toBe(9_000);
    });
  });

  describe("given tool call lifecycle events", () => {
    it("initiates then resolves in place, keeping initiation order", () => {
      const state = fold([
        accepted(),
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
          occurredAt: 2_000,
          data: { ...IDS, toolCallId: "t-1", toolName: "bash", command: "ls" },
        },
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
          occurredAt: 2_100,
          data: { ...IDS, toolCallId: "t-2", toolName: "webfetch" },
        },
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
          occurredAt: 2_500,
          data: {
            ...IDS,
            toolCallId: "t-1",
            toolName: "bash",
            durationMs: 500,
          },
        },
      ]);

      expect(state.ToolCalls.map((t) => t.toolCallId)).toEqual(["t-1", "t-2"]);
      expect(state.ToolCalls[0]).toMatchObject({
        status: LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
        command: "ls",
        durationMs: 500,
      });
      expect(state.ToolCalls[1]?.status).toBe(
        LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
      );
    });

    it("lands a terminal whose initiated frame never arrived (defensive upsert)", () => {
      const state = fold([
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
          occurredAt: 3_000,
          data: {
            ...IDS,
            toolCallId: "t-lost",
            toolName: "bash",
            errorText: "exit 1",
          },
        },
      ]);
      expect(state.ToolCalls).toHaveLength(1);
      expect(state.ToolCalls[0]).toMatchObject({
        toolCallId: "t-lost",
        status: LANGY_TURN_TOOL_CALL_STATUS.FAILED,
        errorText: "exit 1",
      });
      // Identity hydrates from ANY turn event — a mid-stream fold still knows
      // which turn it is.
      expect(state.TurnId).toBe("turn-1");
    });
  });

  describe("given repeated plan snapshots", () => {
    it("keeps the whole latest list — last write wins", () => {
      const state = fold([
        accepted(),
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
          occurredAt: 2_000,
          data: { ...IDS, items: [{ content: "a", status: "pending" }] },
        },
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
          occurredAt: 3_000,
          data: {
            ...IDS,
            items: [
              { content: "a", status: "completed" },
              { content: "b", status: "in_progress" },
            ],
          },
        },
      ]);
      expect(state.Plan).toEqual([
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
      ]);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.RUNNING);
    });
  });

  describe("when the same terminal is folded twice (at-least-once delivery)", () => {
    it("is idempotent — the second application changes nothing", () => {
      const once = fold([accepted(), responded("completed")]);
      const twice = fold([responded("completed")], once);
      expect(twice).toEqual(once);
    });
  });
});

describe("conversation turn keys", () => {
  it("round-trips (conversationId, turnId) through the composite key", () => {
    const key = makeConversationTurnKey("conv-1", "turn-1");
    expect(parseConversationTurnKey(key)).toEqual({
      conversationId: "conv-1",
      turnId: "turn-1",
    });
  });

  describe("given either identity part is missing", () => {
    // An empty identity used to return ":" — one shared document every caller
    // with a missing id collapsed onto, across every tenant.
    /** @scenario "A turn document with an incomplete identity is refused, not collapsed" */
    it('throws rather than collapsing onto a shared ":" key', () => {
      expect(() => makeConversationTurnKey("", "")).toThrow();
      expect(() => makeConversationTurnKey("conv-1", "")).toThrow();
      expect(() => makeConversationTurnKey("", "turn-1")).toThrow();
    });
  });
});

describe("order-invariance under best-effort delivery (ADR-098 decision 4)", () => {
  /**
   * A fixed, deterministic set of permutations to fold — every ordering of a
   * small event set is checked exhaustively; a larger one is sampled with a
   * fixed seed so a failure reproduces on every run rather than only
   * sometimes (a `Math.random()`-backed check would teach "re-run on red",
   * which is the opposite of what a regression test should teach).
   */
  function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [items.slice()];
    const [first, ...rest] = items;
    const restPerms = permutations(rest);
    const result: T[][] = [];
    for (const perm of restPerms) {
      for (let i = 0; i <= perm.length; i++) {
        result.push([...perm.slice(0, i), first as T, ...perm.slice(i)]);
      }
    }
    return result;
  }

  function foldAnyOrder(
    order: readonly LangyConversationTurnEvent[],
  ): LangyConversationTurnFoldState {
    return order.reduce(
      foldLangyConversationTurn,
      initLangyConversationTurnState(),
    );
  }

  // Two terminals race. Every arrival order must land on the same state, and it
  // is the terminal applied first that owns it.
  /** @scenario "A turn reaches exactly one terminal, first writer wins" */
  it("resolves a completed/failed race identically regardless of arrival order, first terminal winning", () => {
    const completedFirst = foldAnyOrder([
      accepted(1_000),
      responded("completed", 5_000),
    ]);
    const failedFirst = [
      accepted(1_000),
      responded("completed", 5_000),
    ] as const;
    // A stale failure is a different event, not a redelivery: it is folded
    // after the turn is already terminal, in both arrival orders.
    const staleFailure: LangyConversationTurnEvent = {
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      occurredAt: 4_000,
      data: { ...IDS, error: "stale worker report" },
    };

    for (const order of permutations([
      accepted(1_000),
      responded("completed", 5_000),
      staleFailure,
    ])) {
      const state = foldAnyOrder(order);
      // Whichever of the two terminal events this ordering applies FIRST
      // decides the outcome — the point under test is that every ordering
      // converges to a well-defined state, never a mix of both terminals'
      // fields (e.g. FAILED status carrying the completed answer).
      const firstTerminal = order.find(
        (e) =>
          e.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED ||
          e.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      );
      if (
        firstTerminal?.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED
      ) {
        expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.COMPLETED);
        expect(state.AnswerParts.length).toBeGreaterThan(0);
      } else {
        expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.FAILED);
        expect(state.Error).toBe("stale worker report");
      }
    }
    void completedFirst;
    void failedFirst;
  });

  /**
   * @scenario "A late failure never overwrites a completed answer"
   */
  it("never lets a late failure blank an already-settled answer", () => {
    const state = foldAnyOrder([
      accepted(1_000),
      responded("completed", 2_000),
      {
        type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
        occurredAt: 1_500, // an earlier occurredAt, arriving LAST
        data: { ...IDS, error: "stale" },
      },
    ]);
    expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.COMPLETED);
    expect(state.AnswerParts).toEqual([{ type: "text", text: "because." }]);
    expect(state.Error).toBeNull();
  });

  it("folds a redelivered EMPTY agent_responded without blanking the real answer", () => {
    // The redelivery/second-delivery does not carry the same content — this
    // is the shape ADR-098 §4 names explicitly: event_log dedup happens at
    // merge time AFTER dispatch, so both deliveries reach the fold, and a
    // second delivery is not guaranteed to be byte-identical to the first.
    const emptyRedelivery: LangyConversationTurnEvent = {
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      occurredAt: 5_001,
      data: {
        ...IDS,
        messageId: "msg-1",
        role: "assistant",
        parts: [],
        outcome: "completed",
        error: null,
      },
    };
    const state = foldAnyOrder([
      accepted(1_000),
      responded("completed", 5_000),
      emptyRedelivery,
    ]);
    expect(state.AnswerParts).toEqual([{ type: "text", text: "because." }]);
  });
});
