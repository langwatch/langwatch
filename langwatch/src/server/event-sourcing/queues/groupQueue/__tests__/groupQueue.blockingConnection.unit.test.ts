/**
 * Regression test: GroupQueueProcessor must duplicate the source connection
 * for its BRPOP loop in BOTH standalone (IORedis) and cluster (Cluster) topologies.
 *
 * Bug: after the PR changed the topology check from duck-type
 * ("duplicate" in effectiveConnection) to instanceof IORedis, a Cluster
 * connection would fall through to the else branch and share the single
 * connection — re-introducing the "BRPOP blocks the shared connection" problem.
 *
 * Fix: add an `instanceof Cluster` branch that calls `.duplicate()` with no args.
 */

import { Cluster, Redis as IORedis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";

// The processor instantiates these collaborators with `new` in consumer mode.
// The mock implementations MUST therefore be constructible — a
// `vi.fn(() => ({ ... }))` arrow-returning factory is NOT a constructor under
// Vitest 4.x and throws `TypeError: ... is not a constructor`, which previously
// made both consumer-mode cases fail before reaching their assertions. Using a
// class keeps the mock constructible.
//
// Mocking them also prevents the real BRPOP dispatcher loop and the metrics
// `setInterval` from starting — both would attempt network I/O and open handles
// that outlive the test.
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
    name: `{test/gq/bc/${crypto.randomUUID().slice(0, 8)}}`,
    process: async () => {},
    groupKey: (p) => p.groupId,
  };
}

describe("GroupQueueProcessor blockingConnection selection", () => {
  const connections: Array<IORedis | Cluster> = [];

  function track<T extends IORedis | Cluster>(conn: T): T {
    connections.push(conn);
    return conn;
  }

  afterEach(() => {
    // Force-close every connection created during the test — even if an
    // assertion threw before the assertions completed — so no socket or
    // reconnect timer outlives the file and wedges the runner.
    for (const conn of connections.splice(0)) {
      conn.disconnect();
    }
    vi.restoreAllMocks();
  });

  describe("given consumer mode is enabled", () => {
    describe("when the source connection is a standalone IORedis", () => {
      it("duplicates the connection with maxRetriesPerRequest: null for the blocking connection", () => {
        const conn = track(
          new IORedis({ lazyConnect: true, maxRetriesPerRequest: 0 }),
        );
        const dupSentinel = {} as IORedis;
        vi.spyOn(conn, "duplicate").mockReturnValue(dupSentinel as any);

        const processor = new GroupQueueProcessor<TestPayload>(
          makeDefinition(),
          conn,
          { consumerEnabled: true },
        );

        expect(conn.duplicate).toHaveBeenCalledWith({
          maxRetriesPerRequest: null,
        });
        expect((processor as any).blockingConnection).toBe(dupSentinel);
      });
    });

    describe("when the source connection is a Redis Cluster", () => {
      it("duplicates the connection for a dedicated blocking connection", () => {
        const conn = track(
          new Cluster([{ host: "127.0.0.1", port: 6379 }], {
            lazyConnect: true,
          }),
        );
        const dupSentinel = {} as Cluster;
        vi.spyOn(conn, "duplicate").mockReturnValue(dupSentinel as any);

        const processor = new GroupQueueProcessor<TestPayload>(
          makeDefinition(),
          conn,
          { consumerEnabled: true },
        );

        expect(conn.duplicate).toHaveBeenCalled();
        expect((processor as any).blockingConnection).toBe(dupSentinel);
      });
    });
  });

  describe("given consumer mode is disabled", () => {
    describe("when the source connection is a standalone IORedis", () => {
      it("uses the shared connection directly without duplicating", () => {
        const conn = track(
          new IORedis({ lazyConnect: true, maxRetriesPerRequest: 0 }),
        );
        const dupSpy = vi.spyOn(conn, "duplicate");

        const processor = new GroupQueueProcessor<TestPayload>(
          makeDefinition(),
          conn,
          { consumerEnabled: false },
        );

        expect(dupSpy).not.toHaveBeenCalled();
        expect((processor as any).blockingConnection).toBe(conn);
      });
    });

    describe("when the source connection is a Redis Cluster", () => {
      it("uses the shared cluster connection directly without duplicating", () => {
        const conn = track(
          new Cluster([{ host: "127.0.0.1", port: 6379 }], {
            lazyConnect: true,
          }),
        );
        const dupSpy = vi.spyOn(conn, "duplicate");

        const processor = new GroupQueueProcessor<TestPayload>(
          makeDefinition(),
          conn,
          { consumerEnabled: false },
        );

        expect(dupSpy).not.toHaveBeenCalled();
        expect((processor as any).blockingConnection).toBe(conn);
      });
    });
  });
});
