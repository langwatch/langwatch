/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@langwatch/coding-agent-contract";
import { CONVERSATION_TURN_CAP, useSessionScrollback } from "../useSessionScrollback";

const { fetchTranscript, fetchSpans, fetchEvents, utils, conversation } = vi.hoisted(
  () => {
    const fetchTranscript = vi.fn();
    const fetchSpans = vi.fn();
    const fetchEvents = vi.fn();
    return {
      fetchTranscript,
      fetchSpans,
      fetchEvents,
      utils: {
        tracesV2: {
          codingAgentTranscript: { fetch: fetchTranscript },
          spansFull: { fetch: fetchSpans },
          traceEvents: { fetch: fetchEvents },
        },
      },
      /** The session's turns, time ascending, as the conversation read returns them. */
      conversation: {
        turns: [] as Array<{
          traceId: string;
          timestamp: number;
          totalTokens?: number | null;
          totalCost?: number | null;
        }>,
        isLoading: false,
      },
    };
  },
);

vi.mock("~/utils/api", () => ({ api: { useUtils: () => utils } }));

vi.mock("../../../../hooks/useConversationContext", () => ({
  useConversationContext: () => ({
    turns: conversation.turns,
    isLoading: conversation.isLoading,
  }),
}));

const SESSION_TURNS = [
  { traceId: "turn-1", timestamp: 1_000, totalTokens: 1_000, totalCost: 0.5 },
  { traceId: "turn-2", timestamp: 2_000, totalTokens: 2_000, totalCost: 0.7 },
  { traceId: "turn-3", timestamp: 3_000, totalTokens: 300, totalCost: 0.06 },
];

const OPENED_ENTRIES: TranscriptEntry[] = [
  { kind: "user_prompt", atMs: 3_000, text: "bump the version", chars: 16 },
];

const EARLIER_ENTRIES: TranscriptEntry[] = [
  { kind: "user_prompt", atMs: 2_000, text: "check git status", chars: 16 },
  {
    kind: "assistant_message",
    atMs: 2_100,
    text: "On branch main.",
    model: "claude-opus-4",
  },
];

const NO_TOOL_SPANS = new Map();

interface Props {
  traceId: string;
  conversationId: string | null;
}

function setup({
  traceId = "turn-3",
  conversationId = "session-a",
}: Partial<Props> = {}) {
  return renderHook(
    (props: Props) =>
      useSessionScrollback({
        projectId: "project-1",
        traceId: props.traceId,
        occurredAtMs: 3_000,
        conversationId: props.conversationId,
        openedTranscript: OPENED_ENTRIES,
        openedToolSpans: NO_TOOL_SPANS,
      }),
    { initialProps: { traceId, conversationId } },
  );
}

/** Let every already-settled promise in the chain deliver. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  conversation.turns = SESSION_TURNS;
  conversation.isLoading = false;
  fetchTranscript.mockReset();
  fetchSpans.mockReset();
  fetchEvents.mockReset();
  fetchTranscript.mockResolvedValue({ entries: EARLIER_ENTRIES });
  fetchSpans.mockResolvedValue([]);
  fetchEvents.mockResolvedValue([]);
});

afterEach(cleanup);

describe("useSessionScrollback", () => {
  describe("given the drawer opened on the newest turn of a session", () => {
    it("counts the turns still above it and offers them", () => {
      const { result } = setup();

      expect(result.current.status).toBe("available");
      expect(result.current.earlierCount).toBe(2);
      expect(result.current.entries).toEqual(OPENED_ENTRIES);
    });

    describe("when the previous turn is asked for", () => {
      it("reads it from the turn's own trace, not the opened one", async () => {
        const { result } = setup();

        await act(async () => {
          result.current.loadEarlier();
        });

        expect(fetchTranscript).toHaveBeenCalledWith(
          { projectId: "project-1", traceId: "turn-2", occurredAtMs: 2_000 },
          { staleTime: 60_000 },
        );
      });

      it("prepends its entries above the opened turn, with a boundary between", async () => {
        const { result } = setup();

        await act(async () => {
          result.current.loadEarlier();
        });

        expect(result.current.entries).toEqual([...EARLIER_ENTRIES, ...OPENED_ENTRIES]);
        expect(result.current.rowKeys).toEqual(["turn-2#0", "turn-2#1", "turn-3#0"]);
        expect(result.current.turnDividers.get(2)).toEqual({
          turnNumber: 3,
          turnCount: 3,
          atMs: 3_000,
        });
      });

      it("walks back one turn at a time, and stops at the session start", async () => {
        const { result } = setup();

        await act(async () => {
          result.current.loadEarlier();
        });
        expect(result.current.status).toBe("available");
        expect(result.current.earlierCount).toBe(1);

        await act(async () => {
          result.current.loadEarlier();
        });

        expect(fetchTranscript).toHaveBeenLastCalledWith(
          expect.objectContaining({ traceId: "turn-1" }),
          expect.anything(),
        );
        expect(result.current.status).toBe("start");
        expect(result.current.earlierCount).toBe(0);
      });
    });

    describe("when the turn's transcript lands before its tool spans", () => {
      it("commits nothing until the whole turn is in hand", async () => {
        let releaseSpans: (spans: unknown[]) => void = () => undefined;
        fetchSpans.mockReturnValue(
          new Promise((resolve) => {
            releaseSpans = resolve;
          }),
        );
        const { result } = setup();

        act(() => {
          result.current.loadEarlier();
        });
        await flush();

        expect(result.current.entries).toEqual(OPENED_ENTRIES);
        expect(result.current.status).toBe("loading");

        await act(async () => {
          releaseSpans([]);
        });

        expect(result.current.entries).toHaveLength(3);
        expect(result.current.status).toBe("available");
      });
    });

    describe("when the reader asks twice before the first read lands", () => {
      it("reads the turn once", async () => {
        const { result } = setup();

        await act(async () => {
          result.current.loadEarlier();
          result.current.loadEarlier();
        });

        expect(fetchTranscript).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the read fails", () => {
      it("says so, and reads it again when asked", async () => {
        fetchTranscript.mockRejectedValueOnce(new Error("clickhouse said no"));
        const { result } = setup();

        await act(async () => {
          result.current.loadEarlier();
        });
        expect(result.current.status).toBe("error");
        expect(result.current.entries).toEqual(OPENED_ENTRIES);

        await act(async () => {
          result.current.loadEarlier();
        });

        expect(fetchTranscript).toHaveBeenCalledTimes(2);
        expect(result.current.entries).toHaveLength(3);
        expect(result.current.status).toBe("available");
      });
    });

    describe("when the reader steps to another turn mid-read", () => {
      it("drops the turn that lands late rather than stacking it onto the new session view", async () => {
        let releaseTranscript: (value: unknown) => void = () => undefined;
        fetchTranscript.mockReturnValue(
          new Promise((resolve) => {
            releaseTranscript = resolve;
          }),
        );
        const { result, rerender } = setup();

        act(() => {
          result.current.loadEarlier();
        });
        rerender({ traceId: "turn-2", conversationId: "session-a" });

        await act(async () => {
          releaseTranscript({ entries: EARLIER_ENTRIES });
        });

        expect(result.current.entries).toEqual(OPENED_ENTRIES);
        expect(result.current.earlierCount).toBe(1);
      });
    });

    describe("when the reader steps to another turn of the same session", () => {
      it("starts from that turn's own history, not the one walked back from the last", async () => {
        const { result, rerender } = setup();
        await act(async () => {
          result.current.loadEarlier();
        });
        expect(result.current.entries).toHaveLength(3);

        rerender({ traceId: "turn-2", conversationId: "session-a" });

        expect(result.current.entries).toEqual(OPENED_ENTRIES);
        expect(result.current.earlierCount).toBe(1);
      });
    });

    describe("when the reader steps away mid-read", () => {
      it("drops the turn instead of committing it onto a ledger they left", async () => {
        let releaseTranscript: (value: unknown) => void = () => undefined;
        fetchTranscript.mockReturnValue(
          new Promise((resolve) => {
            releaseTranscript = resolve;
          }),
        );
        const { result, rerender } = setup();
        act(() => {
          result.current.loadEarlier();
        });

        rerender({ traceId: "turn-2", conversationId: "session-a" });
        await act(async () => {
          releaseTranscript({ entries: EARLIER_ENTRIES });
        });

        // Stepping back finds the turn was never prepended. A read that lands
        // after the reader moved belongs to the ledger they were on, and
        // committing it would grow that history behind their back.
        rerender({ traceId: "turn-3", conversationId: "session-a" });
        expect(result.current.entries).toEqual(OPENED_ENTRIES);
      });
    });
  });

  describe("given the session's turns carry their totals", () => {
    describe("when the drawer opens with the earlier turns unloaded", () => {
      /** @scenario "The footer counts the whole session up to the reader's position" */
      it("sums the unloaded earlier turns and anchors the clock at turn one", () => {
        const { result } = setup();

        expect(result.current.earlierTotals).toEqual({
          tokens: 3_000,
          costUsd: 1.2,
        });
        expect(result.current.sessionStartAtMs).toBe(1_000);
      });
    });

    describe("when an earlier turn is loaded", () => {
      /** @scenario "Loading an earlier turn does not change the footer's totals" */
      it("moves a loaded turn's share out of the baseline", async () => {
        const { result } = setup();

        await act(async () => {
          result.current.loadEarlier();
        });

        expect(result.current.earlierTotals).toEqual({
          tokens: 1_000,
          costUsd: 0.5,
        });
      });
    });

    describe("when one of the turns carries no totals", () => {
      /** @scenario "The footer states no total it cannot count in full" */
      it("reports no total rather than a sum short by that turn", () => {
        conversation.turns = [
          { traceId: "turn-1", timestamp: 1_000 },
          {
            traceId: "turn-2",
            timestamp: 2_000,
            totalTokens: 50,
            totalCost: 1,
          },
          { traceId: "turn-3", timestamp: 3_000 },
        ];
        const { result } = setup();

        expect(result.current.earlierTotals).toEqual({
          tokens: null,
          costUsd: null,
        });
      });
    });

    describe("when the reader may not see cost", () => {
      /** @scenario "A reader who may not see cost still reads the session's tokens" */
      it("keeps the token total and reports no cost", () => {
        conversation.turns = [
          {
            traceId: "turn-1",
            timestamp: 1_000,
            totalTokens: 40,
            totalCost: null,
          },
          {
            traceId: "turn-2",
            timestamp: 2_000,
            totalTokens: 60,
            totalCost: null,
          },
          {
            traceId: "turn-3",
            timestamp: 3_000,
            totalTokens: 10,
            totalCost: null,
          },
        ];
        const { result } = setup();

        expect(result.current.earlierTotals).toEqual({
          tokens: 100,
          costUsd: null,
        });
      });
    });
  });

  describe("given the session's turn list is still being read", () => {
    describe("when the drawer asks for the scrollback", () => {
      it("reports pending rather than a session-less trace", () => {
        conversation.turns = [];
        conversation.isLoading = true;
        const { result } = setup();

        expect(result.current.status).toBe("pending");
        expect(result.current.earlierTotals).toBeNull();
        expect(result.current.sessionStartAtMs).toBeNull();
      });
    });
  });

  describe("given a trace that belongs to no session", () => {
    describe("when the drawer asks for the scrollback", () => {
      it("offers no scrollback at all", () => {
        const { result } = setup({ conversationId: null });

        expect(result.current.status).toBe("hidden");
        expect(result.current.earlierCount).toBe(0);
        expect(result.current.entries).toEqual(OPENED_ENTRIES);
        expect(result.current.earlierTotals).toBeNull();
        expect(result.current.sessionStartAtMs).toBeNull();
      });
    });
  });

  describe("given the drawer opened on the session's first turn", () => {
    it("reports the start, with nothing above it to read", () => {
      const { result } = setup({ traceId: "turn-1" });

      expect(result.current.status).toBe("start");
      expect(result.current.earlierCount).toBe(0);
    });

    it("asks for nothing when the top is reached anyway", async () => {
      const { result } = setup({ traceId: "turn-1" });

      await act(async () => {
        result.current.loadEarlier();
      });

      expect(fetchTranscript).not.toHaveBeenCalled();
    });
  });

  describe("given a session longer than the turn list reaches", () => {
    beforeEach(() => {
      conversation.turns = Array.from({ length: CONVERSATION_TURN_CAP }, (_, index) => ({
        traceId: `turn-${index}`,
        timestamp: index * 1_000,
      }));
    });

    describe("when the opened turn is past the end of the list", () => {
      it("says the earlier turns are out of reach rather than pretending to be at the start", () => {
        const { result } = setup({ traceId: "turn-way-back" });

        expect(result.current.status).toBe("unavailable");
      });
    });

    describe("when the opened turn is inside the list", () => {
      it("walks back to the list's first turn and calls that the session start", async () => {
        const { result } = setup({ traceId: "turn-1" });
        expect(result.current.status).toBe("available");
        expect(result.current.earlierCount).toBe(1);

        await act(async () => {
          result.current.loadEarlier();
        });

        // A full list truncates the RECENT end, never the old one: the read
        // walks the session forward from its first turn, so reaching turns[0]
        // is the beginning however long the session went on to run.
        expect(result.current.earlierCount).toBe(0);
        expect(result.current.status).toBe("start");
      });
    });
  });
});
