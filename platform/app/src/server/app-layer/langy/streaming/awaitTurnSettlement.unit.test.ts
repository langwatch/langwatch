/**
 * @vitest-environment node
 *
 * The buffered path of `awaitTurnSettlement`: with Redis present, the token
 * buffer's follow() is the promptness source and the durable fold stays the
 * only settlement authority. Pinned here:
 *
 *   - A terminal frame from the buffer accelerates settlement, but the answer
 *     always comes from the fold (buffer says "settled", fold says what to).
 *   - The signal aborting mid-wait returns null and releases the blocking
 *     Redis connection.
 *   - An aborted follow() is never mistaken for a settlement signal.
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetEventsAfter = vi.fn();
const mockDuplicate = vi.fn();
const mockDisconnect = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    langy: { conversations: { getEventsAfter: mockGetEventsAfter } },
  })),
  tryGetApp: vi.fn(() => ({ redis: { duplicate: mockDuplicate } })),
}));

const mockReadTail = vi.fn();
const mockFollow = vi.fn();

vi.mock("./langyTokenBuffer", () => ({
  createLangyTokenBuffer: vi.fn(() => ({
    readTail: mockReadTail,
    follow: mockFollow,
  })),
}));

const { awaitTurnSettlement } = await import("./awaitTurnSettlement");

const emptyTail = {
  events: [],
  cursor: { acceptedAt: 0, eventId: "" },
  truncated: false,
};

const settledFold = {
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

const ARGS = {
  projectId: "project-1",
  conversationId: "conv-1",
  turnId: "turn-1",
  userId: "user-1",
};

describe("awaitTurnSettlement (buffered path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDuplicate.mockReturnValue({ disconnect: mockDisconnect });
    mockReadTail.mockResolvedValue({ reads: [], lastId: "0" });
  });

  it("settles fast when follow() delivers the terminal frame, answer from the fold", async () => {
    // Fold is behind on the first read, settled on the confirm re-read.
    mockGetEventsAfter
      .mockResolvedValueOnce(emptyTail)
      .mockResolvedValue(settledFold);
    // follow() yields the terminal immediately — no fold-poll tick is needed.
    mockFollow.mockImplementation(async function* () {
      yield { id: "1-1", entry: { type: "end" } };
    });

    const settlement = await awaitTurnSettlement({
      ...ARGS,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toEqual({
      succeeded: true,
      outcome: "completed",
      text: "from the fold",
      error: null,
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("settles from the tail alone when the terminal was already buffered", async () => {
    mockReadTail.mockResolvedValue({
      reads: [{ id: "1-1", entry: { type: "end" } }],
      lastId: "1-1",
    });
    mockFollow.mockImplementation(async function* () {
      throw new Error("follow must not run when the tail holds the terminal");
    });
    mockGetEventsAfter.mockResolvedValue(settledFold);

    const settlement = await awaitTurnSettlement({
      ...ARGS,
      signal: AbortSignal.timeout(5_000),
      pollIntervalMs: 5,
    });

    expect(settlement).toMatchObject({ succeeded: true });
  });

  it("returns null on abort without treating the ended follow() as settlement", async () => {
    mockGetEventsAfter.mockResolvedValue(emptyTail);
    // follow() honors the signal: it ends (without terminal) when aborted.
    mockFollow.mockImplementation(async function* (opts: {
      signal: AbortSignal;
    }) {
      await new Promise((resolve) =>
        opts.signal.addEventListener("abort", resolve, { once: true }),
      );
    });

    const settlement = await awaitTurnSettlement({
      ...ARGS,
      signal: AbortSignal.timeout(50),
      pollIntervalMs: 5,
    });

    expect(settlement).toBeNull();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
