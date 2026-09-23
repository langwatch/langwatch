/**
 * A cell blocked on a slow model stops when the run does: the read races the
 * abort flag, and cancelling the reader disconnects the engine.
 * @see specs/experiments-v3/execution-backend.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
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
