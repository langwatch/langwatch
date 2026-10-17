import type { ModelProviderApi } from "@langwatch/model-provider-contract";
/**
 * A cell blocked on a slow model stops when the run does: the read races the
 * abort flag, and cancelling the reader disconnects the engine.
 * @see specs/experiments-v3/execution-backend.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  parseStudioWorkflow,
  type StudioClientEvent,
  type StudioServerEvent,
} from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowStudioStream } from "../../channels/nlp-lambda.channel.ts";
import { WorkflowStudioDispatchService } from "../workflow-studio-dispatch.service.ts";

const blockedCell: StudioClientEvent = {
  type: "execute_component",
  payload: {
    trace_id: "trace-1",
    node_id: "node-1",
    inputs: {},
    workflow: parseStudioWorkflow({
      workflow_id: "wf-1",
      spec_version: "1.4",
      name: "blocked",
      icon: "x",
      description: "x",
      version: "1.0",
      nodes: [],
      edges: [],
      state: {},
    }),
  },
};

/** A stream port answering with whichever reader a scenario hands it. */
class FixedStream implements WorkflowStudioStream {
  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  open(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    return Promise.resolve(this.reader);
  }
}

const dispatch = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  WorkflowStudioDispatchService.create({
    stream: new FixedStream(reader),
    modelProviders: createApiFixture<ModelProviderApi>({
      getForProject: async () => ({}),
    }),
  });

describe("given a studio run streaming from a slow model", () => {
  describe("when the stop is asked for while a read is still pending", () => {
    /** @scenario "Stopping a running workbench execution halts it mid-stream" */
    it("interrupts the pending read, cancels the reader and delivers nothing further", async () => {
      const cancel = vi.fn(async () => undefined);
      // A read that never resolves: only the abort race can end the loop, so
      // reaching cancel proves the pending read was interrupted.
      const reader: ReadableStreamDefaultReader<Uint8Array> = {
        read: () => new Promise<never>(() => undefined),
        cancel,
        releaseLock: vi.fn(),
        closed: Promise.resolve(undefined),
      };
      const onEvent = vi.fn<(event: StudioServerEvent) => void>();
      let stopped = false;

      const running = dispatch(reader).postEvent({
        projectId: "project-1",
        event: blockedCell,
        onEvent,
        isAborted: async () => stopped,
      });
      setTimeout(() => {
        stopped = true;
      }, 20);

      await running;

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(onEvent).not.toHaveBeenCalled();
    });
  });
});

describe("given a studio run that finishes before any stop", () => {
  describe("when the engine's last frame arrives", () => {
    it("reads the stream to its end and cancels nothing", async () => {
      const cancel = vi.fn(async () => undefined);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
          controller.close();
        },
      });
      const source = stream.getReader();
      const reader: ReadableStreamDefaultReader<Uint8Array> = {
        read: () => source.read(),
        cancel,
        releaseLock: vi.fn(),
        closed: Promise.resolve(undefined),
      };
      const onEvent = vi.fn<(event: StudioServerEvent) => void>();

      await dispatch(reader).postEvent({
        projectId: "project-1",
        event: blockedCell,
        onEvent,
        isAborted: async () => false,
      });

      expect(cancel).not.toHaveBeenCalled();
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "done" }));
    });
  });
});

describe("given a studio run whose abort poll's Redis check rejects (langwatch#8534)", () => {
  describe("when a pod shutting down closes the connection mid-poll", () => {
    /**
     * The poll timer runs detached from any awaited call chain (it is driven
     * by `setInterval`, not the `Promise.race` it feeds), so an unhandled
     * rejection there escapes `postEvent`'s own try/catch entirely and crashes
     * the process — this is what prod saw. A rejected poll check must be
     * treated as "not aborted" so the run keeps going until the connection
     * recovers.
     */
    it("does not raise an unhandled rejection when the poll's abort check rejects", async () => {
      // A read that never resolves on its own: only the abort race (the poll
      // timer) can end the loop. `cancel` resolving lets the test prove
      // postEvent actually settles, not just that a timeout gave up on it — if
      // it never settled, its `finally` would never clear the poll's
      // `setInterval`, leaking a timer that keeps firing past this test.
      const cancel = vi.fn(async () => undefined);
      const reader: ReadableStreamDefaultReader<Uint8Array> = {
        read: () => new Promise<never>(() => undefined),
        cancel,
        releaseLock: vi.fn(),
        closed: Promise.resolve(undefined),
      };
      const onEvent = vi.fn<(event: StudioServerEvent) => void>();

      const unhandled: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandledRejection);

      let callCount = 0;
      const redisClosed = new Error("Connection is closed.");
      // The pre-read check (call 1) passes. The next two poll ticks (calls 2
      // and 3) reject, as a closed Redis connection would while a pod is
      // shutting down. The connection then "recovers" (call 4 resolves true),
      // ending the test deterministically instead of on a timeout — proving
      // the rejecting ticks didn't wedge the poll or leave it unable to
      // resolve once isAborted succeeds again.
      const isAborted = vi.fn(async () => {
        callCount++;
        if (callCount === 1) return false;
        if (callCount <= 3) throw redisClosed;
        return true;
      });

      try {
        await dispatch(reader).postEvent({
          projectId: "project-1",
          event: blockedCell,
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
