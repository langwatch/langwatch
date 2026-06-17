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

// Prevent the real BRPOP dispatcher loop from starting — it would attempt
// network I/O and open timer handles that outlive the test.
vi.mock("../dispatcher", () => {
  return {
    GroupQueueDispatcher: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      requestShutdown: vi.fn(),
      waitUntilStopped: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

type TestPayload = { id: string; groupId: string };

function makeDefinition(): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gq/bc/${crypto.randomUUID().slice(0, 8)}}`,
    process: async () => {},
    groupKey: (p) => p.groupId,
  };
}

describe("GroupQueueProcessor blockingConnection selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given consumer mode is enabled", () => {
    describe("when the source connection is a standalone IORedis", () => {
      it("duplicates the connection with maxRetriesPerRequest: null for the blocking connection", async () => {
        const conn = new IORedis({
          lazyConnect: true,
          maxRetriesPerRequest: 0,
        });
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

        conn.disconnect();
      });
    });

    describe("when the source connection is a Redis Cluster", () => {
      it("duplicates the connection for a dedicated blocking connection", async () => {
        const conn = new Cluster([{ host: "127.0.0.1", port: 6379 }], {
          lazyConnect: true,
        });
        const dupSentinel = {} as Cluster;
        vi.spyOn(conn, "duplicate").mockReturnValue(dupSentinel as any);

        const processor = new GroupQueueProcessor<TestPayload>(
          makeDefinition(),
          conn,
          { consumerEnabled: true },
        );

        expect(conn.duplicate).toHaveBeenCalled();
        expect((processor as any).blockingConnection).toBe(dupSentinel);

        conn.disconnect();
      });
    });
  });

  describe("given consumer mode is disabled", () => {
    describe("when the source connection is a standalone IORedis", () => {
      it("uses the shared connection directly without duplicating", async () => {
        const conn = new IORedis({
          lazyConnect: true,
          maxRetriesPerRequest: 0,
        });
        const dupSpy = vi.spyOn(conn, "duplicate");

        const processor = new GroupQueueProcessor<TestPayload>(
          makeDefinition(),
          conn,
          { consumerEnabled: false },
        );

        expect(dupSpy).not.toHaveBeenCalled();
        expect((processor as any).blockingConnection).toBe(conn);

        conn.disconnect();
      });
    });

    describe("when the source connection is a Redis Cluster", () => {
      it("uses the shared cluster connection directly without duplicating", async () => {
        const conn = new Cluster([{ host: "127.0.0.1", port: 6379 }], {
          lazyConnect: true,
        });
        const dupSpy = vi.spyOn(conn, "duplicate");

        const processor = new GroupQueueProcessor<TestPayload>(
          makeDefinition(),
          conn,
          { consumerEnabled: false },
        );

        expect(dupSpy).not.toHaveBeenCalled();
        expect((processor as any).blockingConnection).toBe(conn);

        conn.disconnect();
      });
    });
  });
});
