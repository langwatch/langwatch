import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetEventsAfter = vi.fn();
const mockDisconnect = vi.fn();
const mockReadTail = vi.fn();
const mockFollow = vi.fn();

const { LangyTurnSettlementWaiterService } =
  await import("../langy-turn-settlement-waiter.service.ts");
const awaitTurnSettlement: ReturnType<
  typeof LangyTurnSettlementWaiterService.create
>["awaitTurnSettlement"] = (input) =>
  LangyTurnSettlementWaiterService.create().awaitTurnSettlement(input);

const emptyPage = {
  events: [],
  cursor: { acceptedAt: 0, eventId: "" },
  truncated: false,
};

const settledPage = {
  events: [
    {
      id: "evt-1",
      createdAt: 1,
      occurredAt: 1,
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      data: {
        conversationId: "conv-1",
        turnId: "turn-1",
        messageId: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "from the fold" }],
        outcome: "completed",
        error: null,
      },
    },
  ],
  cursor: { acceptedAt: 1, eventId: "evt-1" },
  truncated: false,
};

const args = {
  langy: { getEventsAfter: mockGetEventsAfter },
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

  it("uses a buffered terminal only to accelerate the durable fold", async () => {
    mockGetEventsAfter.mockResolvedValueOnce(emptyPage).mockResolvedValue(settledPage);
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
      settlement: { succeeded: true, outcome: "completed", text: "from the fold", error: null },
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("settles from a terminal already in the buffer", async () => {
    mockReadTail.mockResolvedValue({
      reads: [{ id: "1-1", entry: { type: "end" } }],
      lastId: "1-1",
    });
    mockGetEventsAfter.mockResolvedValue(settledPage);

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toMatchObject({ kind: "settled", settlement: { succeeded: true } });
  });

  it("returns null on abort without treating an ended follow as a terminal", async () => {
    mockGetEventsAfter.mockResolvedValue(emptyPage);
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

  /** @scenario "A wait is satisfied only by the turn this request started" */
  it("keeps waiting past another turn's settlement until its own turn settles", async () => {
    const otherTurnPage = {
      ...settledPage,
      events: [
        {
          ...settledPage.events[0],
          id: "evt-0",
          data: {
            ...settledPage.events[0]!.data,
            turnId: "turn-2",
            parts: [{ type: "text", text: "not mine" }],
          },
        },
      ],
    };
    mockGetEventsAfter.mockResolvedValueOnce(otherTurnPage).mockResolvedValue(settledPage);
    mockFollow.mockImplementation(async function* () {
      yield { id: "1-1", entry: { type: "end" } };
    });

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toMatchObject({ kind: "settled", settlement: { text: "from the fold" } });
    expect(mockGetEventsAfter.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("awaitTurnSettlement (user wait)", () => {
  const userWaitEvent = {
    id: "evt-wait",
    createdAt: 1,
    occurredAt: 1,
    type: LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED,
    data: {
      conversationId: "conv-1",
      turnId: "turn-1",
      waitId: "wait-1",
      kind: "question",
      expiresAt: 600_000,
      questions: [
        { question: "What would you like to do?", options: [] },
        { question: "Which project?", options: [] },
      ],
    },
  };
  const otherTurnWaitEvent = {
    ...userWaitEvent,
    id: "evt-wait-other",
    data: { ...userWaitEvent.data, turnId: "turn-0", waitId: "wait-0" },
  };
  const waitingPage = {
    events: [otherTurnWaitEvent, userWaitEvent],
    cursor: { acceptedAt: 1, eventId: "evt-wait" },
    truncated: false,
  };

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

  describe("given a turn whose fold records a question wait and no reply", () => {
    /** @scenario "A user wait settles the wait only when the caller opts in" */
    it("settles as awaiting_user carrying the question text when the caller opted in", async () => {
      mockGetEventsAfter.mockResolvedValue(waitingPage);

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
      mockGetEventsAfter.mockResolvedValue(waitingPage);

      const settlement = await awaitTurnSettlement({
        ...args,
        signal: AbortSignal.timeout(50),
        pollIntervalMs: 5,
      });

      expect(settlement).toEqual({ kind: "stopped" });
    });
  });

  describe("given a turn whose fold records both a question wait and a completed reply", () => {
    /** @scenario "A reply in the fold wins over a user wait" */
    it("settles as the completed reply, even when the reply is on a later page", async () => {
      const laterPageReply = {
        events: [{ ...settledPage.events[0], id: "evt-2", createdAt: 2 }],
        cursor: { acceptedAt: 2, eventId: "evt-2" },
        truncated: false,
      };
      mockGetEventsAfter
        .mockResolvedValueOnce({ ...waitingPage, truncated: true })
        .mockResolvedValue(laterPageReply);

      const settlement = await awaitTurnSettlement({
        ...args,
        signal: AbortSignal.timeout(5_000),
        pollIntervalMs: 5,
        shouldSettleOnUserWait: true,
      });

      expect(settlement).toEqual({
        kind: "settled",
        settlement: { succeeded: true, outcome: "completed", text: "from the fold", error: null },
      });
      expect(mockGetEventsAfter).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ after: waitingPage.cursor }),
      );
    });
  });
});
