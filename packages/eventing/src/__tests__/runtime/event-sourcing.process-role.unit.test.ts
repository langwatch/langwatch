import type * as groupQueueModule from "@langwatch/group-queue";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  producers: [] as string[],
  consumers: [] as string[],
}));

vi.mock("@langwatch/group-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof groupQueueModule>();

  class CapturingProducer {
    constructor(definition: { name: string }) {
      captured.producers.push(definition.name);
    }
    async send(): Promise<void> {}
    async sendBatch(): Promise<void> {}
    async waitUntilReady(): Promise<void> {}
    async close(): Promise<void> {}
  }

  class CapturingConsumer {
    constructor(private readonly definition: { name: string }) {}
    handle() {
      captured.consumers.push(this.definition.name);
      return { async waitUntilReady() {}, async close() {} };
    }
    handleBatch() {
      captured.consumers.push(this.definition.name);
      return { async waitUntilReady() {}, async close() {} };
    }
  }

  return {
    ...actual,
    GroupQueueProducer: CapturingProducer,
    GroupQueueConsumer: CapturingConsumer,
  };
});

const { createEventingGroupQueueFactory } = await import("../../queues/groupQueueFactory.ts");

/**
 * The shared queue is built for a process by its composition root, which
 * decides whether it consumes or only produces. `consumersEnabled` is where a
 * process role lands here — Redis and deployment shape live outside this package.
 */
function buildSharedQueue({ consumersEnabled }: { consumersEnabled: boolean }): void {
  const factory = createEventingGroupQueueFactory({
    dependencies: { redis: {} as never },
    consumersEnabled,
  });
  factory({
    name: "event-sourcing/jobs",
    groupKey: () => "group-1",
    score: () => 0,
    process: async () => {},
  });
}

describe("the shared event queue a process builds", () => {
  describe("given a process that runs the workers", () => {
    it("builds the consumer beside the producer", () => {
      captured.producers.length = 0;
      captured.consumers.length = 0;

      buildSharedQueue({ consumersEnabled: true });

      expect(captured.producers).toEqual(["event-sourcing/jobs"]);
      expect(captured.consumers).toEqual(["event-sourcing/jobs"]);
    });
  });

  describe("given a process that only serves requests", () => {
    it("builds the producer alone, so nothing drains the queue here", () => {
      captured.producers.length = 0;
      captured.consumers.length = 0;

      buildSharedQueue({ consumersEnabled: false });

      expect(captured.producers).toEqual(["event-sourcing/jobs"]);
      expect(captured.consumers).toEqual([]);
    });
  });
});
