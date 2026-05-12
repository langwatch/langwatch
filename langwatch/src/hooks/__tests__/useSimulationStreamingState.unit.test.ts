/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createStreamingStore,
  type StreamingMessage,
} from "../useSimulationStreamingState";

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

function makeMsg(
  overrides: Partial<StreamingMessage> & { messageId: string },
): StreamingMessage {
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
  // clearByIds()
  // -----------------------------------------------------------------------
  describe("clearByIds()", () => {
    it("removes completed messages matching IDs", () => {
      store.upsert("m1", makeMsg({ messageId: "m1", status: "complete" }));
      store.upsert("m2", makeMsg({ messageId: "m2", status: "complete" }));
      raf.flush();

      store.clearByIds(["m1"]);
      raf.flush();

      expect(store.getSnapshot()).toHaveLength(1);
      expect(store.getSnapshot()[0]!.messageId).toBe("m2");
    });

    it("keeps streaming messages even if ID matches", () => {
      store.upsert("m1", makeMsg({ messageId: "m1", status: "streaming" }));
      raf.flush();

      store.clearByIds(["m1"]);
      raf.flush();

      expect(store.getSnapshot()).toHaveLength(1);
      expect(store.getSnapshot()[0]!.messageId).toBe("m1");
    });

    it("does not notify if no messages removed", () => {
      store.upsert("m1", makeMsg({ messageId: "m1", status: "streaming" }));
      raf.flush();

      const listener = vi.fn();
      store.subscribe(listener);

      store.clearByIds(["m1"]); // m1 is streaming, not removed
      // No RAF should be scheduled
      expect(raf.pending).toBe(0);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Early delta TTL cleanup
  // -----------------------------------------------------------------------
  describe("early delta TTL cleanup", () => {
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
  describe("RAF batching", () => {
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
  });
});
