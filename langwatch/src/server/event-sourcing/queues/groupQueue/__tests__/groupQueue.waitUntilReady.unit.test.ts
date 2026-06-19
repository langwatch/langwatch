/**
 * Regression test: GroupQueueProcessor.waitUntilReady() must survive a normal
 * ioredis reconnect cycle.
 *
 * Bug: rejecting readiness on the first `error` (or `close`) event turned an
 * ordinary transient ioredis reconnect into a startup failure. On an
 * unavailable endpoint with maxRetriesPerRequest: null, ioredis emits
 * `error` → `close` → `reconnecting` and can later emit `ready`; the old code
 * rejected at the first event instead of waiting for recovery.
 *
 * Fix: keep waiting across transient `error`/`close` events and resolve on
 * `ready`; reject only on the terminal `end` event.
 */

import { EventEmitter } from "node:events";
import { Redis as IORedis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";

// Constructible class mocks — the processor instantiates these with `new` in
// consumer mode, and their real implementations open timers / Redis I/O that
// would outlive the test.
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

/**
 * Minimal stand-in for an ioredis connection that lets a test drive the
 * lifecycle events (`error`, `close`, `reconnecting`, `ready`, `end`) by hand.
 */
class FakeConnection extends EventEmitter {
  status = "connecting";
}

type TestPayload = { id: string; groupId: string };

function makeDefinition(): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gq/wur/${crypto.randomUUID().slice(0, 8)}}`,
    process: async () => {},
    groupKey: (p) => p.groupId,
  };
}

describe("GroupQueueProcessor waitUntilReady", () => {
  const connections: IORedis[] = [];

  function makeProcessor(blocking: FakeConnection): GroupQueueProcessor<TestPayload> {
    const conn = new IORedis({ lazyConnect: true, maxRetriesPerRequest: 0 });
    connections.push(conn);
    // In consumer mode the processor builds its blocking connection via
    // `.duplicate()`; hand it our controllable fake so the test drives its
    // lifecycle directly.
    vi.spyOn(conn, "duplicate").mockReturnValue(blocking as any);
    return new GroupQueueProcessor<TestPayload>(makeDefinition(), conn, {
      consumerEnabled: true,
    });
  }

  afterEach(() => {
    for (const conn of connections.splice(0)) {
      conn.disconnect();
    }
    vi.restoreAllMocks();
  });

  describe("given the blocking connection is reconnecting", () => {
    describe("when it emits error -> close -> reconnecting -> ready", () => {
      it("resolves readiness instead of rejecting on the transient error/close", async () => {
        const blocking = new FakeConnection();
        const processor = makeProcessor(blocking);

        const ready = processor.waitUntilReady();
        // Capture the outcome as a settled value so a premature rejection can't
        // escape as an unhandled rejection while we drive the lifecycle.
        const outcome = ready.then(
          () => "resolved" as const,
          (err) => ({ rejected: err }),
        );

        // A normal ioredis reconnect cycle against an unavailable endpoint with
        // maxRetriesPerRequest: null.
        blocking.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379"));
        blocking.emit("close");
        blocking.emit("reconnecting", 50);
        blocking.status = "ready";
        blocking.emit("ready");

        await expect(outcome).resolves.toBe("resolved");
      });
    });
  });

  describe("given the blocking connection terminates", () => {
    describe("when it emits end without ever becoming ready", () => {
      it("rejects readiness on the terminal end event", async () => {
        const blocking = new FakeConnection();
        const processor = makeProcessor(blocking);

        const ready = processor.waitUntilReady();
        const outcome = ready.then(
          () => "resolved" as const,
          (err: Error) => err.message,
        );

        blocking.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379"));
        blocking.emit("close");
        blocking.emit("end");

        await expect(outcome).resolves.toMatch(/ended before ready/i);
      });
    });
  });
});
