import { GroupQueueError, type GroupQueueDependencies } from "@langwatch/group-queue";
import { describe, expect, it, vi } from "vitest";

import { createEventingGroupQueueFactory } from "../groupQueueFactory.ts";

type Each = (payload: Record<string, unknown>, context: { attempt: number }) => Promise<void>;

/** The single-job handler the factory hands the consumer, as a worker would run it. */
let each: Each = async () => {};

vi.mock("@langwatch/group-queue", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const running = {
    waitUntilReady: async () => {},
    pause: () => {},
    resume: () => {},
    close: async () => {},
  };
  class FakeConsumer {
    handle(handler: Each) {
      each = handler;
      return running;
    }
    handleBatch({ each: handler }: { each: Each }) {
      each = handler;
      return running;
    }
  }
  class FakeProducer {
    async close(): Promise<void> {}
  }
  return { ...actual, GroupQueueProducer: FakeProducer, GroupQueueConsumer: FakeConsumer };
});

/** A handler that asks to be retried later, as a subscriber waiting on another module does. */
const waitALittle = () =>
  new GroupQueueError({
    queueName: "trace",
    operation: "recordEvaluationOutcome",
    message: "trace is not stored yet; its evaluation outcome is retried",
    retryAfterMs: 15 * 60 * 1000,
  });

function startedQueue({ batched }: { batched: boolean }) {
  const named = waitALittle();
  const queue = createEventingGroupQueueFactory({
    dependencies: { redis: {} } as GroupQueueDependencies<Record<string, unknown>>,
  })({
    name: "named-delay",
    process: () => Promise.reject(named),
    ...(batched ? { processBatch: async () => {} } : {}),
  });
  queue.start?.();
  return named;
}

describe("createEventingGroupQueueFactory single job", () => {
  describe.each([
    { batched: false, queue: "a queue with no batch handler" },
    { batched: true, queue: "a queue that also handles batches" },
  ])("given $queue", ({ batched }) => {
    describe("when a job's handler names a retry delay", () => {
      it("reaches the queue as thrown, so the queue keeps the delay", async () => {
        const named = startedQueue({ batched });

        const thrown = await each({ tenantId: "t" }, { attempt: 2 }).catch((e: unknown) => e);

        expect(thrown).toBe(named);
        expect(thrown).toMatchObject({ retryAfterMs: 15 * 60 * 1000 });
      });
    });
  });
});
