import { describe, expect, it, vi } from "vitest";
import { OpsMetricsCollector } from "../ops-metrics-collector.service";
import { OpsMetricsTestAdapter } from "./ops-metrics.fixture";

function createMockRedis() {
  return {
    pipeline: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      zadd: vi.fn(),
      zremrangebyscore: vi.fn(),
      smembers: vi.fn(),
    }),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    info: vi.fn().mockResolvedValue(""),
    smembers: vi.fn().mockResolvedValue([]),
    zrange: vi.fn().mockResolvedValue([]),
  } as unknown as import("ioredis").default;
}

/**
 * Drive the private reconcile through the public discovery path, then read the
 * dashboard the way the UI does.
 */
const runReconcile = async (ops: OpsMetricsTestAdapter) => {
  const collector = new OpsMetricsCollector({
    redis: createMockRedis(),
    ops,
  });
  await collector.discoverQueues();
  // Access via bracket notation to avoid exposing a test-only public API.
  await (
    collector as unknown as { reconcilePending(): Promise<void> }
  ).reconcilePending();
  return collector.getDashboardData().pendingDrift;
};

describe("OpsMetricsCollector", () => {
  describe("reconcilePending()", () => {
    describe("given this instance measured the drift itself", () => {
      describe("when reconcilePending runs", () => {
        /**
         * The published figure and the locally measured one are deliberately
         * different here. Reporting the local sum (40) would pass on a test
         * that used matching numbers, so they are kept apart to make the two
         * outcomes distinguishable.
         */
        it("reports the published drift rather than its own measurement", async () => {
          const ops = OpsMetricsTestAdapter.create();
          ops.setQueueNames(["queue-alpha", "queue-beta"]);
          ops.enqueuePendingReconciliations([
            { counter: 130, groundTruth: 100, drift: 30 },
            { counter: 40, groundTruth: 50, drift: -10 },
          ]);
          ops.setPendingDrift(97);

          expect(await runReconcile(ops)).toBe(97);
        });
      });
    });

    // The reconcile is single-flighted, so on any cycle most instances win no
    // marker and measure nothing. Reporting what they measured would report 0
    // drift for a queue that has plenty.
    describe("given this instance won no single-flight marker", () => {
      describe("when reconcilePending runs", () => {
        it("still reports the drift another instance published", async () => {
          const ops = OpsMetricsTestAdapter.create();
          ops.setQueueNames(["queue-alpha", "queue-beta"]);
          ops.enqueuePendingReconciliations([null, null]);
          ops.setPendingDrift(42);

          expect(await runReconcile(ops)).toBe(42);
        });
      });
    });

    describe("given every queue reports no drift", () => {
      describe("when reconcilePending runs", () => {
        it("reports zero", async () => {
          const ops = OpsMetricsTestAdapter.create();
          ops.setQueueNames(["queue-alpha"]);
          ops.enqueuePendingReconciliations([{ counter: 5, groundTruth: 5, drift: 0 }]);

          expect(await runReconcile(ops)).toBe(0);
        });
      });
    });
  });
});
