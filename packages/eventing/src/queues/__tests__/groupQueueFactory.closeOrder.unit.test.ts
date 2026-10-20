/**
 * The producer's staging gate closes when its own close finishes, so it must close
 * after every consumer has drained.
 * @see specs/background/queue-drain-send-gate.feature
 */

import type { GroupQueueDependencies } from "@langwatch/group-queue";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEventingGroupQueueFactory } from "../groupQueueFactory.ts";

const steps: string[] = [];
/** Answers each consumer's close; `listed` is true for the listed-work consumer. */
let consumerClose: (listed: boolean) => Promise<void> = async () => {};

vi.mock("@langwatch/group-queue", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeProducer {
    async close(): Promise<void> {
      steps.push("producer closed");
    }
  }
  class FakeConsumer {
    private readonly listed: boolean;
    constructor(_definition: unknown, dependencies: { dispatchListed?: boolean }) {
      this.listed = dependencies.dispatchListed === true;
    }
    handle() {
      return {
        waitUntilReady: async () => {},
        pause: () => {},
        resume: () => {},
        close: () => consumerClose(this.listed),
      };
    }
  }
  return { ...actual, GroupQueueProducer: FakeProducer, GroupQueueConsumer: FakeConsumer };
});

function startedQueue({ listedConsumer = false }: { listedConsumer?: boolean } = {}) {
  const queue = createEventingGroupQueueFactory({
    dependencies: { redis: {} } as GroupQueueDependencies<Record<string, unknown>>,
    listedConsumer,
  })({ name: "close-order", process: async () => {} });
  queue.start?.();
  return queue;
}

describe("createEventingGroupQueueFactory close", () => {
  afterEach(() => {
    steps.length = 0;
    consumerClose = async () => {};
  });

  describe("given a consumer that is still draining", () => {
    describe("when the queue closes", () => {
      /** @scenario The producer closes only after every consumer has drained */
      it("closes the producer only once the consumer's drain has finished", async () => {
        let finishDrain: () => void = () => {};
        consumerClose = () =>
          new Promise<void>((resolve) => {
            finishDrain = () => {
              steps.push("consumer drained");
              resolve();
            };
          });
        const queue = startedQueue();

        const closing = queue.close();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(steps).toEqual([]);

        finishDrain();
        await closing;
        expect(steps).toEqual(["consumer drained", "producer closed"]);
      });
    });
  });

  describe("given a consumer whose drain fails", () => {
    describe("when the queue closes", () => {
      /** @scenario The producer closes only after every consumer has drained */
      it("still closes the producer and reports the drain failure", async () => {
        const drainFailure = new Error("Shutdown timed out");
        consumerClose = () => Promise.reject(drainFailure);
        const queue = startedQueue();

        await expect(queue.close()).rejects.toBe(drainFailure);
        expect(steps).toEqual(["producer closed"]);
      });
    });
  });

  describe("given one consumer whose drain fails while the other is still draining", () => {
    describe("when the queue closes", () => {
      /** @scenario The producer closes only after every consumer has drained */
      it("closes the producer only once the other drain has finished", async () => {
        const drainFailure = new Error("Shutdown timed out");
        let finishDrain: () => void = () => {};
        consumerClose = (listed) =>
          listed
            ? new Promise<void>((resolve) => {
                finishDrain = () => {
                  steps.push("listed consumer drained");
                  resolve();
                };
              })
            : Promise.reject(drainFailure);
        const queue = startedQueue({ listedConsumer: true });

        const closing = queue.close();
        const outcome = expect(closing).rejects.toBe(drainFailure);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(steps).toEqual([]);

        finishDrain();
        await outcome;
        expect(steps).toEqual(["listed consumer drained", "producer closed"]);
      });
    });
  });
});
