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
});
