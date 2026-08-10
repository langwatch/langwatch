/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import { useSessionScrollback } from "../useSessionScrollback";

const { fetchTranscript, fetchSpans, fetchEvents, utils, conversation } =
  vi.hoisted(() => {
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
        turns: [] as Array<{ traceId: string; timestamp: number }>,
      },
    };
  });

vi.mock("~/utils/api", () => ({ api: { useUtils: () => utils } }));

vi.mock("../../../../hooks/useConversationContext", () => ({
  useConversationContext: () => ({ turns: conversation.turns }),
}));

const SESSION_TURNS = [
  { traceId: "turn-1", timestamp: 1_000 },
  { traceId: "turn-2", timestamp: 2_000 },
  { traceId: "turn-3", timestamp: 3_000 },
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

        expect(result.current.entries).toEqual([
          ...EARLIER_ENTRIES,
          ...OPENED_ENTRIES,
        ]);
        expect(result.current.rowKeys).toEqual([
          "turn-2#0",
          "turn-2#1",
          "turn-3#0",
        ]);
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

    describe("when the drawer closes mid-read", () => {
      it("lets the read settle without touching a ledger that is gone", async () => {
        let releaseTranscript: (value: unknown) => void = () => undefined;
        fetchTranscript.mockReturnValue(
          new Promise((resolve) => {
            releaseTranscript = resolve;
          }),
        );
        const { result, unmount } = setup();
        act(() => {
          result.current.loadEarlier();
        });

        unmount();

        await expect(
          act(async () => {
            releaseTranscript({ entries: EARLIER_ENTRIES });
          }),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("given a trace that belongs to no session", () => {
    it("offers no scrollback at all", () => {
      const { result } = setup({ conversationId: null });

      expect(result.current.status).toBe("hidden");
      expect(result.current.earlierCount).toBe(0);
      expect(result.current.entries).toEqual(OPENED_ENTRIES);
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
    it("says the earlier turns are out of reach rather than pretending to be at the start", () => {
      conversation.turns = Array.from({ length: 200 }, (_, index) => ({
        traceId: `turn-${index}`,
        timestamp: index * 1_000,
      }));

      const { result } = setup({ traceId: "turn-way-back" });

      expect(result.current.status).toBe("unavailable");
    });
  });
});
