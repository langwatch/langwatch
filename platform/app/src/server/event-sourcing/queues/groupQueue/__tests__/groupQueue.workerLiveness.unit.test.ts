/**
 * The poison guard books a worker death when a claim marker's owner has no
 * liveness beacon (specs/event-sourcing/poison-group-park-guard.feature). That
 * makes the ORDER of the two writes in `close()` load-bearing: the beacon
 * refresh runs on an interval, so retiring first and stopping the timer second
 * leaves a window where a refresh overwrites the `retired` tombstone with a
 * 90-second `alive` — which then expires into exactly the false death the
 * tombstone exists to prevent.
 */

import { Redis as IORedis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";

vi.mock("../dispatcher", () => ({
  GroupQueueDispatcher: class {
    start(): void {}
    requestShutdown(): void {}
    async waitUntilStopped(): Promise<void> {}
  },
}));

vi.mock("../metricsCollector", () => ({
  GroupQueueMetricsCollector: class {
    start(): void {}
    stop(): void {}
  },
}));

type TestPayload = { id: string; groupId: string };

function makeDefinition(): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gq/live/${crypto.randomUUID().slice(0, 8)}}`,
    process: async () => {},
    groupKey: (p) => p.groupId,
  };
}

describe("GroupQueueProcessor worker liveness beacon", () => {
  const connections: IORedis[] = [];

  afterEach(() => {
    for (const conn of connections.splice(0)) conn.disconnect();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createProcessor() {
    const conn = new IORedis({ lazyConnect: true, maxRetriesPerRequest: 0 });
    connections.push(conn);
    vi.spyOn(conn, "duplicate").mockReturnValue(conn as never);

    const processor = new GroupQueueProcessor<TestPayload>(
      makeDefinition(),
      conn,
      { consumerEnabled: true },
    );
    const internals = processor as unknown as {
      workerId: string;
      livenessReady: Promise<void>;
      livenessTimer: ReturnType<typeof setInterval> | undefined;
      scripts: {
        recordWorkerAlive: (workerId: string) => Promise<void>;
        retireWorker: (workerId: string) => Promise<void>;
      };
      drainAndDisconnect: () => Promise<void>;
    };
    // The real drain talks to Redis; the beacon ordering is decided before it.
    internals.drainAndDisconnect = async () => {};
    return { processor, internals };
  }

  describe("given a consumer that has published its beacon", () => {
    describe("when the worker retires", () => {
      /** @scenario the liveness beacon stops before the retirement tombstone is written */
      it("stops the refresh timer before writing the tombstone", async () => {
        const { processor, internals } = createProcessor();

        const order: string[] = [];
        vi.spyOn(internals.scripts, "recordWorkerAlive").mockImplementation(
          async () => {
            order.push("alive");
          },
        );
        vi.spyOn(internals.scripts, "retireWorker").mockImplementation(
          async () => {
            order.push("retired");
          },
        );

        await internals.livenessReady;
        expect(internals.livenessTimer).toBeDefined();

        await processor.close();

        // The timer is cleared, so no refresh can follow the tombstone.
        expect(internals.livenessTimer).toBeUndefined();
        expect(internals.scripts.retireWorker).toHaveBeenCalledWith(
          internals.workerId,
        );
        expect(order.at(-1)).toBe("retired");
      });
    });
  });

  describe("given a producer-only queue", () => {
    describe("when it is constructed", () => {
      it("publishes no beacon, because it never claims", async () => {
        const conn = new IORedis({
          lazyConnect: true,
          maxRetriesPerRequest: 0,
        });
        connections.push(conn);

        const processor = new GroupQueueProcessor<TestPayload>(
          makeDefinition(),
          conn,
          { consumerEnabled: false },
        );
        const internals = processor as unknown as {
          livenessReady: Promise<void>;
          livenessTimer: ReturnType<typeof setInterval> | undefined;
        };

        await internals.livenessReady;
        expect(internals.livenessTimer).toBeUndefined();
      });
    });
  });

  describe("given two processors in the same process", () => {
    describe("when each takes a claim", () => {
      it("gives them distinct worker identities", () => {
        const { internals: first } = createProcessor();
        const { internals: second } = createProcessor();

        // A shared identity would let one processor's death resolve as the
        // other's liveness, and vice versa.
        expect(first.workerId).not.toBe(second.workerId);
      });
    });
  });
});
