import type { ModelProviderApi } from "@langwatch/model-provider-contract";
/**
 * A failure the watcher raises on an event reaches its own caller whole, so a field it carries
 * (the provider's HTTP status) is not lost to a message-only error event.
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowStudioStream } from "../../channels/nlp-lambda.channel.ts";
import { WorkflowStudioDispatchService } from "../workflow-studio-dispatch.service.ts";

class RejectedWithStatus extends Error {
  constructor(readonly upstreamStatus: number) {
    super("provider said no");
  }
}

function readerOf(frames: string): ReadableStreamDefaultReader<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      controller.close();
    },
  }).getReader();
}

const stream = (reader: ReadableStreamDefaultReader<Uint8Array>): WorkflowStudioStream => ({
  open: async () => reader,
});

describe("given a studio run whose caller rejects an event with a typed failure", () => {
  describe("when the stream is read", () => {
    /** @scenario "A failure the caller raises while reading keeps its own type and fields" */
    it("rethrows that failure once, with its fields, and reports no rewritten event", async () => {
      const onEvent = vi.fn(() => {
        throw new RejectedWithStatus(429);
      });
      const service = WorkflowStudioDispatchService.create({
        stream: stream(readerOf('data: {"type":"error","payload":{"message":"x"}}\n\n')),
        modelProviders: createApiFixture<ModelProviderApi>({ getForProject: async () => ({}) }),
      });

      const run = service.postEvent({
        projectId: "project-1",
        event: { type: "stop_execution", payload: { trace_id: "t" } },
        onEvent,
      });

      await expect(run).rejects.toMatchObject({ upstreamStatus: 429 });
      expect(onEvent).toHaveBeenCalledTimes(1);
    });
  });
});
