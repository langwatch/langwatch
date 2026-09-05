/**
 * The producer gate must close when the DRAIN ends, not when shutdown is requested.
 * @see specs/background/queue-drain-send-gate.feature
 */

import { Redis as IORedis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";

/** Released by hand so the drain can be held open mid-close. */
let releaseDrain: (() => void) | undefined;
const requestShutdown = vi.fn();

vi.mock("../dispatcher", () => ({
  GroupQueueDispatcher: class {
    start(): void {}
    requestShutdown(): void {
      requestShutdown();
    }
    async waitUntilStopped(): Promise<void> {
      await new Promise<void>((resolve) => {
        releaseDrain = resolve;
      });
    }
  },
}));

vi.mock("../metricsCollector", () => ({
  GroupQueueMetricsCollector: class {
    start(): void {}
    stop(): void {}
  },
}));

type TestPayload = { id: string; groupId: string };

/** Thrown by groupKey, which send() reaches only after passing the gate. */
class PastTheGate extends Error {
  constructor() {
    super("past the gate");
  }
}

function makeDefinition(): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gq/gate/${crypto.randomUUID().slice(0, 8)}}`,
    process: async () => {},
    // Staging needs Redis, which a unit test has no business reaching. The
    // first thing send() does after the gate is resolve the group key, so
    // throwing here proves the gate let the call through without this test
    // having to stage anything.
    groupKey: () => {
      throw new PastTheGate();
    },
  };
}

/**
 * Waits until the drain is genuinely open. NOT `requestShutdown` — close() calls that before it
 * starts draining, so a test keying off it races ahead of the window it means to observe and
 * the drain then runs to its full budget.
 */
async function drainIsOpen(): Promise<void> {
  await vi.waitUntil(() => releaseDrain !== undefined);
}

describe("GroupQueueProcessor staging gate during shutdown", () => {
  const connections: IORedis[] = [];

  function makeProcessor(): GroupQueueProcessor<TestPayload> {
    const conn = new IORedis({ lazyConnect: true, maxRetriesPerRequest: 0 });
    connections.push(conn);
    vi.spyOn(conn, "lpush").mockResolvedValue(1 as never);
    vi.spyOn(conn, "duplicate").mockReturnValue({
      quit: vi.fn().mockResolvedValue("OK"),
    } as never);

    const processor = new GroupQueueProcessor<TestPayload>(makeDefinition(), conn, {
      consumerEnabled: true,
    });
    vi.spyOn(
      (processor as unknown as { scripts: { retireWorker: () => unknown } }).scripts,
      "retireWorker",
    ).mockResolvedValue(undefined as never);
    return processor;
  }

  afterEach(() => {
    releaseDrain?.();
    releaseDrain = undefined;
    requestShutdown.mockClear();
    for (const conn of connections.splice(0)) conn.disconnect();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("given a queue that has begun draining", () => {
    /** @scenario Work produced by an in-flight job during the drain is still staged */
    it("lets an in-flight job stage downstream work", async () => {
      const processor = makeProcessor();
      const closing = processor.close();
      await drainIsOpen();

      await expect(processor.send({ id: "a", groupId: "g" })).rejects.toThrow(PastTheGate);

      releaseDrain?.();
      await closing;
    });

    /** @scenario Batched work produced during the drain is also staged */
    it("lets an in-flight job stage a batch of downstream work", async () => {
      const processor = makeProcessor();
      const closing = processor.close();
      await drainIsOpen();

      await expect(processor.sendBatch([{ id: "a", groupId: "g" }])).rejects.toThrow(PastTheGate);

      releaseDrain?.();
      await closing;
    });

    /** @scenario The dispatcher stops claiming new jobs as soon as shutdown starts */
    /** @scenario "Closing a GroupQueueConsumer drains claimed work within its budget" */
    it("stops the dispatcher claiming further jobs", async () => {
      const processor = makeProcessor();
      const closing = processor.close();
      await drainIsOpen();

      expect(requestShutdown).toHaveBeenCalledTimes(1);

      releaseDrain?.();
      await closing;
    });
  });

  describe("given a queue whose drain has finished", () => {
    /** @scenario Staging is refused once the drain is over */
    it("refuses further work, naming shutdown as the reason", async () => {
      const processor = makeProcessor();
      const closing = processor.close();
      await drainIsOpen();
      releaseDrain?.();
      await closing;

      await expect(processor.send({ id: "a", groupId: "g" })).rejects.toThrow(/drain has finished/);
      await expect(processor.sendBatch([{ id: "a", groupId: "g" }])).rejects.toThrow(
        /drain has finished/,
      );
    });
  });

  describe("given a queue whose drain overran its budget", () => {
    /** @scenario A drain that overran its budget still closes the gate */
    /** @scenario "Closing a GroupQueueConsumer drains claimed work within its budget" */
    it("refuses further work even though the drain never finished", async () => {
      vi.useFakeTimers();
      const processor = makeProcessor();
      // Never released, so close() loses its race against the shutdown budget.
      const closing = processor.close();
      const settled = expect(closing).rejects.toThrow(/timed out/);

      await vi.advanceTimersByTimeAsync(60_000);
      await settled;

      await expect(processor.send({ id: "a", groupId: "g" })).rejects.toThrow(/drain has finished/);
    });
  });
});
