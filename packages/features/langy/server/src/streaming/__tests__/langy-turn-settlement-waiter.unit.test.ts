import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetEventsAfter = vi.fn();
const mockDuplicate = vi.fn();
const mockDisconnect = vi.fn();
const mockReadTail = vi.fn();
const mockFollow = vi.fn();

vi.mock("../langy-token-buffer", () => ({
  LangyTokenBuffer: {
    create: vi.fn(() => ({
      readTail: mockReadTail,
      follow: mockFollow,
    })),
  },
}));

const { awaitTurnSettlement } = await import("../langy-turn-settlement-waiter");

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
  redis: { duplicate: mockDuplicate },
  projectId: "project-1",
  conversationId: "conv-1",
  turnId: "turn-1",
  userId: "user-1",
};

describe("awaitTurnSettlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDuplicate.mockReturnValue({ disconnect: mockDisconnect });
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
      succeeded: true,
      outcome: "completed",
      text: "from the fold",
      error: null,
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

    expect(settlement).toMatchObject({ succeeded: true });
  });

  it("returns null on abort without treating an ended follow as a terminal", async () => {
    mockGetEventsAfter.mockResolvedValue(emptyPage);
    mockFollow.mockImplementation(async function* (input: { signal: AbortSignal }) {
      await new Promise((resolve) =>
        input.signal.addEventListener("abort", resolve, { once: true }),
      );
    });

    const settlement = await awaitTurnSettlement({
      ...args,
      signal: AbortSignal.timeout(50),
      pollIntervalMs: 5,
    });

    expect(settlement).toBeNull();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
