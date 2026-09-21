import { describe, expect, it, vi } from "vitest";
import type { LangyStreamEntry, LangyStreamRead } from "../langyTokenBuffer";
import type { TurnHealth } from "../langyTurnSettlement";
import { WEDGED_TURN_PATIENCE_MS } from "../langyTurnSettlement";
import { streamTurnEntries, type TurnTailBuffer } from "../langyTurnTail";

const CONVERSATION = { conversationId: "conv_1", turnId: "turn_1" };

/**
 * The manager's own budget for answering ONE request, which the tail used to
 * borrow as an absolute deadline. Nothing enforces it here any more; it is the
 * length the tests below run past to prove that.
 */
const MANAGER_REQUEST_BUDGET_MS = 120_000;

/** A poll that waits for nothing, so a test spends ticks instead of seconds. */
const immediately = () =>
  new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 0));

/**
 * A live edge the test drives: entries appear when it pushes them, and the
 * follow ends when the turn's terminal arrives, the edge closes, or the tail
 * gives the stream up (the real buffer stops on the same signal).
 */
function createLiveEdge() {
  const pending: LangyStreamRead[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let id = 0;

  return {
    push(entry: LangyStreamEntry) {
      id += 1;
      pending.push({ id: `0-${id}`, entry });
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *follow({ signal }: { signal?: AbortSignal }) {
      while (!signal?.aborted) {
        while (pending.length) {
          const read = pending.shift();
          if (read) yield read;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          const done = () => {
            signal?.removeEventListener("abort", done);
            wake = null;
            resolve();
          };
          wake = done;
          signal?.addEventListener("abort", done, { once: true });
        });
      }
    },
  };
}

function createBuffer({
  tail = [],
  live,
}: {
  tail?: LangyStreamEntry[];
  live: ReturnType<typeof createLiveEdge>;
}): TurnTailBuffer {
  return {
    readTail: async () => ({
      reads: tail.map((entry, index) => ({ id: `0-${index}`, entry })),
      lastId: tail.length ? `0-${tail.length - 1}` : "0",
    }),
    follow: ({ signal }) => live.follow({ signal }),
  };
}

/** Collect what the tail yields, without blocking the test on it. */
function pump(entries: AsyncGenerator<LangyStreamEntry>) {
  const received: LangyStreamEntry[] = [];
  const done = (async () => {
    for await (const entry of entries) received.push(entry);
  })();
  return { received, done };
}

describe("streamTurnEntries", () => {
  const pollMs = 5_000;

  describe("when the turn keeps beating far longer than one manager request", () => {
    /** @scenario "A turn that runs longer than the manager's request budget keeps its stream" */
    it("keeps delivering the agent's UI actions to the page that is watching", async () => {
      const live = createLiveEdge();
      let polls = 0;
      const release = vi.fn();
      const beating: TurnHealth = { isStale: false, terminal: null };

      const { received, done } = pump(
        streamTurnEntries({
          ...CONVERSATION,
          buffer: createBuffer({ live }),
          readHealth: async () => {
            polls += 1;
            return beating;
          },
          signal: new AbortController().signal,
          release,
          pollMs,
          delay: immediately,
        }),
      );

      // Run the turn past the deadline the tail used to carry, so a UI action
      // after it is one the old two-minute cap would have swallowed.
      await vi.waitFor(() =>
        expect(polls * pollMs).toBeGreaterThan(MANAGER_REQUEST_BUDGET_MS),
      );
      const action: LangyStreamEntry = {
        type: "ui",
        actionId: "act_1",
        kind: "workbench.duplicateTarget",
        payload: { targetId: "target_1" },
      };
      live.push(action);

      await vi.waitFor(() => expect(received).toContainEqual(action));
      expect(release).not.toHaveBeenCalled();

      live.push({ type: "end" });
      await done;
      expect(release).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the turn neither settles nor beats", () => {
    /** @scenario "A turn that neither settles nor beats gives its stream up" */
    it("stops following, releases the blocking connection, and synthesizes nothing", async () => {
      const live = createLiveEdge();
      const release = vi.fn();
      // Stale, and the fold never settles it: the wedged turn nothing else
      // cleans up. The live edge stays open, so only the tail can end this.
      const wedged: TurnHealth = { isStale: true, terminal: null };

      const { received, done } = pump(
        streamTurnEntries({
          ...CONVERSATION,
          buffer: createBuffer({
            tail: [{ type: "status", status: "thinking" }],
            live,
          }),
          readHealth: async () => wedged,
          signal: new AbortController().signal,
          release,
          pollMs,
          delay: immediately,
        }),
      );

      await done;

      expect(release).toHaveBeenCalledTimes(1);
      expect(received).toEqual([{ type: "status", status: "thinking" }]);
      expect(received.some((entry) => entry.type === "end")).toBe(false);
      expect(received.some((entry) => entry.type === "error")).toBe(false);
    });

    it("waits out the whole patience before it does", async () => {
      const live = createLiveEdge();
      let polls = 0;

      const { done } = pump(
        streamTurnEntries({
          ...CONVERSATION,
          buffer: createBuffer({ live }),
          readHealth: async () => {
            polls += 1;
            return { isStale: true, terminal: null };
          },
          signal: new AbortController().signal,
          release: () => undefined,
          pollMs,
          delay: immediately,
        }),
      );

      await done;
      expect(polls * pollMs).toBe(WEDGED_TURN_PATIENCE_MS);
    });
  });

  describe("when the reader walks away mid-turn", () => {
    it("releases the blocking connection on the way out", async () => {
      const live = createLiveEdge();
      const release = vi.fn();
      const reader = new AbortController();

      const { received, done } = pump(
        streamTurnEntries({
          ...CONVERSATION,
          buffer: createBuffer({ live }),
          readHealth: async () => ({ isStale: false, terminal: null }),
          signal: reader.signal,
          release,
          pollMs,
          delay: immediately,
        }),
      );

      live.push({ type: "delta", text: "working" });
      await vi.waitFor(() => expect(received).toHaveLength(1));

      reader.abort();
      await done;
      expect(release).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the buffer already holds the whole turn", () => {
    it("replays it and ends without following the live edge", async () => {
      const live = createLiveEdge();
      const follow = vi.fn(() => live.follow({}));
      const release = vi.fn();

      const { received, done } = pump(
        streamTurnEntries({
          ...CONVERSATION,
          buffer: {
            ...createBuffer({
              tail: [{ type: "delta", text: "hi" }, { type: "end" }],
              live,
            }),
            follow,
          },
          readHealth: async () => null,
          signal: new AbortController().signal,
          release,
          pollMs,
          delay: immediately,
        }),
      );

      await done;
      expect(received).toEqual([
        { type: "delta", text: "hi" },
        { type: "end" },
      ]);
      expect(follow).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });
  });
});
