/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStreamingStore, type StreamingMessage } from "../use-simulation-streaming-state.ts";

type Store = ReturnType<typeof createStreamingStore>;

/** Captures the latest RAF callback so we can flush it synchronously. */
function captureRaf() {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  return {
    flush() {
      const pending = [...callbacks];
      callbacks.length = 0;
      for (const cb of pending) cb(performance.now());
    },
    get pending() {
      return callbacks.length;
    },
  };
}

function makeMsg(overrides: Partial<StreamingMessage> & { messageId: string }): StreamingMessage {
  return {
    role: "assistant",
    content: "",
    status: "streaming",
    ...overrides,
  };
}

describe("createStreamingStore()", () => {
  let store: Store;
  let raf: ReturnType<typeof captureRaf>;

  beforeEach(() => {
    vi.useFakeTimers();
    raf = captureRaf();
    store = createStreamingStore();
  });

  afterEach(() => {
    store.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // upsert()
  // -----------------------------------------------------------------------
  describe("upsert()", () => {
    describe("when adding a new message", () => {
      it("adds it to messages", () => {
        const msg = makeMsg({ messageId: "m1", content: "hello" });
        store.upsert("m1", msg);
        raf.flush();

        expect(store.getSnapshot()).toEqual([msg]);
      });
    });

    describe("when replacing an existing message", () => {
      it("replaces it", () => {
        store.upsert("m1", makeMsg({ messageId: "m1", content: "first" }));
        raf.flush();

        const replacement = makeMsg({ messageId: "m1", content: "second" });
        store.upsert("m1", replacement);
        raf.flush();

        expect(store.getSnapshot()).toEqual([replacement]);
      });
    });

    describe("when early deltas were buffered", () => {
      it("applies them to the new message content", () => {
        store.appendDelta("m1", "hel");
        store.appendDelta("m1", "lo");

        store.upsert("m1", makeMsg({ messageId: "m1", content: "" }));
        raf.flush();

        expect(store.getSnapshot()[0]!.content).toBe("hello");
      });
    });
  });

  // -----------------------------------------------------------------------
  // appendDelta()
  // -----------------------------------------------------------------------
  describe("appendDelta()", () => {
    describe("when message exists", () => {
      it("appends delta to content", () => {
        store.upsert("m1", makeMsg({ messageId: "m1", content: "hel" }));
        raf.flush();

        store.appendDelta("m1", "lo");
        raf.flush();

        expect(store.getSnapshot()[0]!.content).toBe("hello");
      });
    });

    describe("when message does not exist", () => {
      it("buffers the delta (early delta)", () => {
        store.appendDelta("m1", "early");

        // No message added yet, snapshot stays empty
        raf.flush();
        expect(store.getSnapshot()).toEqual([]);
      });
    });

    describe("when message is later upserted after early buffering", () => {
      it("early deltas are applied", () => {
        store.appendDelta("m1", "A");
        store.appendDelta("m1", "B");

        store.upsert("m1", makeMsg({ messageId: "m1", content: "_" }));
        raf.flush();

        expect(store.getSnapshot()[0]!.content).toBe("_AB");
      });
    });
  });

  // -----------------------------------------------------------------------
  // complete()
  // -----------------------------------------------------------------------
  describe("complete()", () => {
    describe("when finalContent is provided", () => {
      it("sets status to complete and replaces content", () => {
        store.upsert("m1", makeMsg({ messageId: "m1", content: "partial" }));
        raf.flush();

        store.complete("m1", "final text");
        raf.flush();

        const msg = store.getSnapshot()[0]!;
        expect(msg.status).toBe("complete");
        expect(msg.content).toBe("final text");
      });
    });

    describe("when finalContent is not provided", () => {
      it("sets status to complete and keeps accumulated content", () => {
        store.upsert("m1", makeMsg({ messageId: "m1", content: "accumulated" }));
        raf.flush();

        store.complete("m1");
        raf.flush();

        const msg = store.getSnapshot()[0]!;
        expect(msg.status).toBe("complete");
        expect(msg.content).toBe("accumulated");
      });
    });

    it("clears early deltas for the messageId", () => {
      // Buffer early deltas then complete without a START
      store.appendDelta("m1", "orphan");
      store.complete("m1");

      // Now upsert — buffered deltas should NOT be applied
      store.upsert("m1", makeMsg({ messageId: "m1", content: "" }));
      raf.flush();

      expect(store.getSnapshot()[0]!.content).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // upsert() with a messageIndex
  // -----------------------------------------------------------------------
  describe("given a completed preview at a message index", () => {
    /** @scenario "A START inserts beside earlier previews, never truncating" */
    it("inserts beside previews at or after that index, never truncating", () => {
      store.upsert("m1", makeMsg({ messageId: "m1", messageIndex: 1 }));
      store.complete("m1", "first");
      store.upsert("m2", makeMsg({ messageId: "m2", messageIndex: 1 }));
      raf.flush();

      expect(store.getSnapshot().map((m) => m.messageId)).toEqual(["m1", "m2"]);
    });
  });

  // -----------------------------------------------------------------------
  // reconcile()
  // -----------------------------------------------------------------------
  describe("reconcile()", () => {
    const stored = (id: string, text: string) => ({ id, text });

    describe("when the run is still going", () => {
      it("removes completed previews whose final text the server holds", () => {
        store.upsert("m1", makeMsg({ messageId: "m1", content: "a" }));
        store.upsert("m2", makeMsg({ messageId: "m2", content: "b" }));
        store.complete("m1");
        store.complete("m2");
        raf.flush();

        store.reconcile({
          serverMessages: [stored("m1", "a")],
          isFinished: false,
        });
        raf.flush();

        expect(store.getSnapshot().map((m) => m.messageId)).toEqual(["m2"]);
      });

      it("keeps the final text while the server holds only the empty START row", () => {
        store.upsert("m1", makeMsg({ messageId: "m1" }));
        store.complete("m1", "final answer");
        raf.flush();

        store.reconcile({
          serverMessages: [stored("m1", "")],
          isFinished: false,
        });
        raf.flush();

        expect(store.getSnapshot()).toEqual([
          expect.objectContaining({ messageId: "m1", content: "final answer" }),
        ]);
      });

      it("keeps the final text while a lagging read holds only part of it", () => {
        store.upsert("m1", makeMsg({ messageId: "m1" }));
        store.complete("m1", "final answer");
        raf.flush();

        store.reconcile({
          serverMessages: [stored("m1", "final")],
          isFinished: false,
        });
        raf.flush();

        expect(store.getSnapshot()).toEqual([
          expect.objectContaining({ messageId: "m1", content: "final answer" }),
        ]);
      });

      it("removes a completed preview with no text once its row is stored", () => {
        store.upsert("tools", makeMsg({ messageId: "tools" }));
        store.complete("tools");
        raf.flush();

        store.reconcile({
          serverMessages: [stored("tools", "")],
          isFinished: false,
        });
        raf.flush();

        expect(store.getSnapshot()).toEqual([]);
      });

      it("keeps in-flight previews while the server lags behind", () => {
        store.upsert("m1", makeMsg({ messageId: "m1", content: "par" }));
        raf.flush();

        store.reconcile({
          serverMessages: [stored("m1", "par")],
          isFinished: false,
        });
        store.appendDelta("m1", "tial");
        raf.flush();

        expect(store.getSnapshot()).toEqual([
          expect.objectContaining({ messageId: "m1", content: "partial" }),
        ]);
      });

      it("keeps a new completed preview while a lagging read holds another id at its index", () => {
        store.upsert("new0", makeMsg({ messageId: "new0", messageIndex: 0, content: "new" }));
        store.complete("new0");
        raf.flush();

        store.reconcile({
          serverMessages: [stored("old0", "old")],
          isFinished: false,
        });
        raf.flush();

        expect(store.getSnapshot().map((m) => m.messageId)).toEqual(["new0"]);
      });

      it("does not notify if no messages removed", () => {
        store.upsert("m1", makeMsg({ messageId: "m1", status: "streaming" }));
        raf.flush();

        const listener = vi.fn();
        store.subscribe(listener);

        store.reconcile({
          serverMessages: [stored("m1", "")],
          isFinished: false,
        });
        expect(raf.pending).toBe(0);
        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("when the run has finished", () => {
      it("removes aborted and orphaned previews alike", () => {
        store.upsert("aborted", makeMsg({ messageId: "aborted" }));
        store.upsert("orphan", makeMsg({ messageId: "orphan", status: "complete" }));
        raf.flush();

        store.reconcile({
          serverMessages: [stored("m0", "hi")],
          isFinished: true,
        });
        raf.flush();

        expect(store.getSnapshot()).toEqual([]);
      });

      it("buffers no late CONTENT and starts no timer", () => {
        store.reconcile({ serverMessages: [], isFinished: true });

        store.appendDelta("late", "x");
        store.complete("late", "y");
        store.upsert("late", makeMsg({ messageId: "late" }));

        expect(vi.getTimerCount()).toBe(0);
        expect(raf.pending).toBe(0);
      });

      it("stops the early delta timer", () => {
        store.appendDelta("orphan", "data");

        store.reconcile({ serverMessages: [], isFinished: true });

        expect(vi.getTimerCount()).toBe(0);
      });

      it("ignores a START that arrives late", () => {
        store.reconcile({ serverMessages: [], isFinished: true });

        store.upsert("late", makeMsg({ messageId: "late" }));
        raf.flush();

        expect(store.getSnapshot()).toEqual([]);
      });
    });
  });

  // -----------------------------------------------------------------------
  // snapshotStored()
  // -----------------------------------------------------------------------
  describe("snapshotStored()", () => {
    it("drops every preview at once, with no START or finished run after it", () => {
      store.upsert("aborted", makeMsg({ messageId: "aborted", content: "ha" }));
      store.upsert("draft", makeMsg({ messageId: "draft" }));
      store.complete("draft", "rolled back text");
      raf.flush();

      store.snapshotStored();
      raf.flush();

      expect(store.getSnapshot()).toEqual([]);
    });

    it("stops the early delta timer", () => {
      store.appendDelta("orphan", "data");

      store.snapshotStored();

      expect(vi.getTimerCount()).toBe(0);
    });

    it("drops buffered early deltas", () => {
      store.appendDelta("m1", "stale");

      store.snapshotStored();
      store.upsert("m1", makeMsg({ messageId: "m1", content: "" }));
      raf.flush();

      expect(store.getSnapshot()[0]!.content).toBe("");
    });

    it("accepts previews that start after it", () => {
      store.snapshotStored();
      store.upsert("next", makeMsg({ messageId: "next" }));
      raf.flush();

      expect(store.getSnapshot().map((m) => m.messageId)).toEqual(["next"]);
    });

    it("keeps a finished run finished", () => {
      store.reconcile({ serverMessages: [], isFinished: true });

      store.snapshotStored();
      store.upsert("late", makeMsg({ messageId: "late" }));
      raf.flush();

      expect(store.getSnapshot()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // reset()
  // -----------------------------------------------------------------------
  describe("reset()", () => {
    it("empties the snapshot at once, without waiting for a frame", () => {
      store.upsert("m1", makeMsg({ messageId: "m1" }));
      raf.flush();

      store.reset();

      expect(store.getSnapshot()).toEqual([]);
    });

    it("drops buffered early deltas", () => {
      store.appendDelta("m1", "stale");

      store.reset();
      store.upsert("m1", makeMsg({ messageId: "m1", content: "" }));
      raf.flush();

      expect(store.getSnapshot()[0]!.content).toBe("");
    });

    it("stops the early delta timer", () => {
      store.appendDelta("orphan", "data");

      store.reset();

      expect(vi.getTimerCount()).toBe(0);
    });

    it("accepts new previews after a finished run", () => {
      store.reconcile({ serverMessages: [], isFinished: true });

      store.reset();
      store.upsert("m1", makeMsg({ messageId: "m1" }));
      raf.flush();

      expect(store.getSnapshot()).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Early delta TTL cleanup
  // -----------------------------------------------------------------------
  describe("given the early delta cleanup timer", () => {
    it("holds no timer until an early delta is buffered", () => {
      expect(vi.getTimerCount()).toBe(0);

      store.appendDelta("orphan", "data");

      expect(vi.getTimerCount()).toBe(1);
    });

    it("stops once START takes the buffered deltas", () => {
      store.appendDelta("m1", "data");

      store.upsert("m1", makeMsg({ messageId: "m1" }));

      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops once the buffered deltas expire", () => {
      store.appendDelta("orphan", "data");

      vi.advanceTimersByTime(15_000);

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("given an orphaned delta past its TTL", () => {
    it("removes orphaned deltas after TTL expires", () => {
      store.appendDelta("orphan", "data");

      // Advance past TTL (10s) + cleanup interval (5s)
      vi.advanceTimersByTime(15_000);

      // Now upsert — buffered deltas should be gone
      store.upsert("orphan", makeMsg({ messageId: "orphan", content: "" }));
      raf.flush();

      expect(store.getSnapshot()[0]!.content).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // RAF batching
  // -----------------------------------------------------------------------
  describe("given notifications batched via requestAnimationFrame", () => {
    it("schedules notification via requestAnimationFrame", () => {
      store.upsert("m1", makeMsg({ messageId: "m1" }));

      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it("updates snapshot only after RAF fires", () => {
      const initial = store.getSnapshot();
      store.upsert("m1", makeMsg({ messageId: "m1", content: "x" }));

      // Before RAF fires, snapshot is still the old reference
      expect(store.getSnapshot()).toBe(initial);

      raf.flush();
      expect(store.getSnapshot()).not.toBe(initial);
      expect(store.getSnapshot()).toHaveLength(1);
    });

    it("coalesces multiple mutations into a single RAF", () => {
      store.upsert("m1", makeMsg({ messageId: "m1" }));
      store.appendDelta("m1", "a");
      store.appendDelta("m1", "b");

      // Only one RAF should be scheduled despite three mutations
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

      raf.flush();
      expect(store.getSnapshot()[0]!.content).toBe("ab");
    });
  });

  // -----------------------------------------------------------------------
  // destroy()
  // -----------------------------------------------------------------------
  describe("destroy()", () => {
    it("cancels RAF, clears interval, empties messages", () => {
      store.upsert("m1", makeMsg({ messageId: "m1" }));
      // RAF is pending

      store.destroy();

      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
      expect(store.getSnapshot()).toEqual([]);
    });

    it("stops the early delta timer", () => {
      store.appendDelta("orphan", "data");

      store.destroy();

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
