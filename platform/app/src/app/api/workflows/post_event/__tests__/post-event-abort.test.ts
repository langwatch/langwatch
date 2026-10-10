/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/execution-backend.feature
 *
 * Layer 2 of the workbench abort fix: a cell blocked waiting on a slow LLM
 * response must not keep running until that response arrives. The stream read
 * races the abort flag, so an abort interrupts the pending read and cancels the
 * reader. Cancelling the reader disconnects nlpgo, whose request context then
 * cancels the in-flight execution.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudioClientEvent } from "../../../../../optimization_studio/types/events";

vi.mock("../../../../../optimization_studio/server/addEnvs", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../optimization_studio/server/addEnvs")
  >("../../../../../optimization_studio/server/addEnvs");
  return { ...actual, getS3CacheKey: () => undefined };
});

// Each test sets the reader the engine call returns, so we can model both a
// blocked read and a clean completion.
let currentReader: ReadableStreamDefaultReader<Uint8Array>;
vi.mock("../../../../../optimization_studio/server/lambda", () => ({
  invokeLambda: vi.fn(async () => currentReader),
}));

const blockedCell = {
  type: "execute_component",
  payload: { trace_id: "t", node_id: "n", inputs: {} },
} as unknown as StudioClientEvent;

const doneFrameReader = () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
      controller.close();
    },
  });
  return stream.getReader();
};

describe("studioBackendPostEvent abort during an in-flight read", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when abort is requested while a read is pending", () => {
    /** @scenario "Stopping a running workbench execution halts it mid-stream" */
    it("interrupts the pending read and cancels the reader", async () => {
      const cancel = vi.fn(async () => {});
      // A read that never resolves: only the abort race can end the loop, so
      // reaching cancel proves the pending read was interrupted.
      currentReader = {
        read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
        cancel,
        releaseLock: vi.fn(),
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;

      let aborted = false;
      const isAborted = vi.fn(async () => aborted);
      const onEvent = vi.fn();

      const { studioBackendPostEvent } = await import("../post-event");
      const done = studioBackendPostEvent({
        projectId: "p",
        message: blockedCell,
        onEvent,
        isAborted,
      });

      setTimeout(() => {
        aborted = true;
      }, 20);

      await done;

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe("when isAborted is provided but never aborts", () => {
    it("passes reads through and does not cancel a stream that completes", async () => {
      const reader = doneFrameReader();
      const cancel = vi.spyOn(reader, "cancel");
      currentReader = reader;

      const onEvent = vi.fn();

      const { studioBackendPostEvent } = await import("../post-event");
      await studioBackendPostEvent({
        projectId: "p",
        message: blockedCell,
        onEvent,
        isAborted: vi.fn(async () => false),
      });

      expect(onEvent).toHaveBeenCalledWith({ type: "done" });
      expect(cancel).not.toHaveBeenCalled();
    });
  });

  describe("when the abort poll's Redis check rejects (langwatch#8534)", () => {
    /**
     * A pod shutting down mid-poll can close the Redis connection the abort
     * check reads from, so `isAborted()` rejects instead of resolving. The
     * poll timer runs detached from any awaited call chain (it is driven by
     * `setInterval`, not the `Promise.race` it feeds), so an unhandled
     * rejection there escapes `studioBackendPostEvent`'s own try/catch
     * entirely and crashes the process — this is what prod saw. The initial
     * per-iteration `isAborted()` check (before each read) is already inside
     * an awaited chain the surrounding try/catch covers; only the detached
     * poll timer needed the fix.
     */
    it("does not raise an unhandled rejection when the poll's abort check rejects", async () => {
      // A read that never resolves on its own: only the abort race (the poll
      // timer) can end the loop. `cancel` resolving lets the test prove
      // `studioBackendPostEvent` actually settles, not just that the test's
      // own timeout gave up on it — if the call never settled, its `finally`
      // would never clear the poll's `setInterval`, leaking a timer that
      // keeps firing (and logging) past this test (caught by review).
      const cancel = vi.fn(async () => {});
      currentReader = {
        read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
        cancel,
        releaseLock: vi.fn(),
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;

      const unhandled: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandledRejection);

      let callCount = 0;
      const redisClosed = new Error("Connection is closed.");
      // The pre-read check (call 1) passes. The next two poll ticks (calls 2
      // and 3) reject, as a closed Redis connection would while a pod is
      // shutting down. The connection then "recovers" (call 4 resolves
      // true), ending the test deterministically instead of relying on a
      // timeout — proving the rejecting ticks didn't wedge the poll or leave
      // it unable to resolve once isAborted succeeds again.
      const isAborted = vi.fn(async () => {
        callCount++;
        if (callCount === 1) return false;
        if (callCount <= 3) throw redisClosed;
        return true;
      });
      const onEvent = vi.fn();

      const { studioBackendPostEvent } = await import("../post-event");
      try {
        // studioBackendPostEvent is awaited directly (no race against a
        // test-side timeout): it must settle on its own once isAborted
        // resolves true, which also proves the poll's `setInterval` is
        // cleared by the real `finally`, not abandoned.
        await studioBackendPostEvent({
          projectId: "p",
          message: blockedCell,
          onEvent,
          isAborted,
        });
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
      }

      expect(unhandled).toEqual([]);
      expect(callCount).toBeGreaterThanOrEqual(4);
      expect(cancel).toHaveBeenCalledTimes(1);
    }, 10_000);
  });
});
