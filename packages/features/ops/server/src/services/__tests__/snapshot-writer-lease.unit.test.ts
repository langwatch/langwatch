import { describe, expect, it, vi } from "vitest";
import { OpsMetricsCollector } from "../ops-metrics-collector.service";
import type { OpsSnapshotService } from "@langwatch/ops-contract";
import { OpsMetricsTestAdapter } from "./ops-metrics.fixture";

/**
 * The lease gate is the whole cost saving in ADR-090: a pod that does not hold
 * the lease must return BEFORE scanning, not merely skip the write. A version
 * that scanned and then discarded would still run ~14 scans a cycle across the
 * fleet and look identical from the outside, so this is worth pinning.
 */

const redisStub = {
  info: vi.fn().mockResolvedValue(""),
  pipeline: () => ({
    get: vi.fn().mockReturnThis(),
    smembers: vi.fn().mockReturnThis(),
    lrange: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    hgetall: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  }),
  zrange: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
};

/**
 * A Redis whose `ops:metrics:state` holds a fleet record, so a pod acquiring
 * the lease has something to take over FROM. Peaks and the rolling history are
 * accumulated rather than derived, so this is the only place they exist.
 */
const makeRedisHoldingState = (state: Record<string, unknown>) => ({
  ...redisStub,
  get: vi.fn().mockResolvedValue(JSON.stringify(state)),
  set: vi.fn().mockResolvedValue("OK"),
});

const FLEET_STATE = {
  version: 3,
  savedAt: 1,
  peakCompletedPerSec: 999,
  peakFailedPerSec: 7,
  peakIngestedPerSec: 42,
  peakLatencyP50Ms: 120,
  peakLatencyP99Ms: 900,
  peakPhases: {},
  peakJobNames: [],
  throughputBuffer: [
    {
      timestamp: Date.now() - 1_000,
      ingestedPerSec: 1,
      completedPerSec: 1,
      failedPerSec: 0,
      pendingCount: 1,
      blockedCount: 0,
      parkedCount: 0,
    },
  ],
  latestTotalCompleted: 5_000,
  latestTotalFailed: 12,
};

const makeOps = () => {
  const ops = OpsMetricsTestAdapter.create();
  ops.setQueueNames(["trace_processing"]);
  return ops;
};

const makeSnapshots = (isHeld: boolean): OpsSnapshotService => ({
  start: vi.fn().mockResolvedValue(void 0),
  stop: vi.fn(),
  tryGetDashboardData: vi.fn().mockReturnValue(null),
  getBadgeCounts: vi.fn().mockReturnValue({
    blockedCount: 0,
    dlqCount: 0,
    computedAt: new Date(0),
  }),
  streamDashboard: vi.fn(),
  acquireOrRenewLease: vi
    .fn()
    .mockResolvedValue({ isHeld, epoch: 1, token: isHeld ? "token-1" : null }),
  releaseLease: vi.fn().mockResolvedValue(void 0),
  writeLive: vi.fn().mockResolvedValue(true),
  writeDetail: vi.fn().mockResolvedValue(true),
});

const makeWriter = (held: boolean) => {
  const ops = makeOps();
  const snapshots = makeSnapshots(held);
  const collector = new OpsMetricsCollector({
    redis: redisStub as any,
    ops,
    snapshots,
    writerId: held ? "holder" : "loser",
  });
  return { collector, ops, snapshots };
};

describe("snapshot writer lease gate", () => {
  describe("given a pod that does not hold the lease", () => {
    describe("when its collection cycle runs", () => {
      /** @scenario "Only the lease holder scans" */
      it("performs no scan at all", async () => {
        const { collector, ops, snapshots } = makeWriter(false);

        await collector.discoverQueues();
        await collector.collect();

        expect(ops.getScanCalls()).toBe(0);
        expect(snapshots.writeLive).not.toHaveBeenCalled();
        expect(collector.isWriter()).toBe(false);
      });
    });
  });

  describe("given the pod holding the lease", () => {
    describe("when its collection cycle runs", () => {
      it("scans and publishes the live artifact", async () => {
        const { collector, ops, snapshots } = makeWriter(true);

        await collector.discoverQueues();
        await collector.collect();

        expect(ops.getScanCalls()).toBeGreaterThan(0);
        expect(snapshots.writeLive).toHaveBeenCalled();
        expect(collector.isWriter()).toBe(true);
      });
    });
  });

  describe("given a holder shutting down cleanly", () => {
    it("hands the lease back rather than letting it lapse", async () => {
      // Waiting out the TTL on a clean shutdown leaves the whole fleet without
      // a writer for the remainder of the window — the rolling-deploy case.
      const { collector, snapshots } = makeWriter(true);
      await collector.discoverQueues();
      await collector.collect();

      await collector.stop();

      expect(snapshots.releaseLease).toHaveBeenCalled();
    });
  });

  describe("given a pod taking over the lease with stale accumulators", () => {
    /** @scenario "Peaks and chart history survive a writer failover" */
    it("publishes the fleet's peaks and history, not its own boot values", async () => {
      // The pod deliberately never calls start(), which models the real case:
      // it booted long ago, has lost every election since, and its in-memory
      // peaks and chart buffer are frozen at zero.
      const redis = makeRedisHoldingState(FLEET_STATE);
      const snapshots = makeSnapshots(true);
      const collector = new OpsMetricsCollector({
        redis: redis as any,
        ops: makeOps(),
        snapshots,
        writerId: "taking-over",
      });

      await collector.discoverQueues();
      await collector.collect();

      const published = (snapshots.writeLive as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0].snapshot;
      expect(published.peakCompletedPerSec).toBe(999);
      expect(published.peakLatencyP99Ms).toBe(900);
      // The restored point is still there, with this cycle's appended after it
      // — the chart continues rather than restarting.
      expect(
        published.throughputHistory.map(
          (point: { timestamp: number }) => point.timestamp,
        ),
      ).toContain(FLEET_STATE.throughputBuffer[0]!.timestamp);
    });

    /** @scenario "A new writer does not overwrite the fleet's record with its own stale copy" */
    it("persists the merged record rather than its own zeroes", async () => {
      // Publishing stale numbers blanks the chart for one cycle; persisting
      // them destroys the fleet's only copy.
      const redis = makeRedisHoldingState(FLEET_STATE);
      const collector = new OpsMetricsCollector({
        redis: redis as any,
        ops: makeOps(),
        snapshots: makeSnapshots(true),
        writerId: "taking-over",
      });

      await collector.discoverQueues();
      await collector.collect();
      await new Promise((resolve) => setImmediate(resolve));

      const written = redis.set.mock.calls.find(
        (call) => call[0] === "ops:metrics:state",
      );
      expect(written).toBeDefined();
      expect(JSON.parse(written![1] as string).peakCompletedPerSec).toBe(999);
    });
  });

  describe("given a detail write the fence rejects", () => {
    /** @scenario "A rejected detail write is not adopted as this pod's state" */
    it("keeps no detail artifact that no reader can see", async () => {
      // The lease turned over mid-scan, so this payload was never published.
      // Adopting it would have the collector report a detail artifact that
      // exists nowhere but in its own memory.
      const snapshots = makeSnapshots(true);
      (snapshots.writeDetail as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const collector = new OpsMetricsCollector({
        redis: redisStub as any,
        ops: makeOps(),
        snapshots,
        writerId: "fenced-out",
      });

      await collector.discoverQueues();
      await collector.collect();
      await new Promise((resolve) => setImmediate(resolve));

      expect(snapshots.writeDetail).toHaveBeenCalled();
      expect(collector.getLatestDetail()).toBeNull();
    });
  });

  describe("given a pod that never held the lease", () => {
    it("releases nothing on shutdown", async () => {
      // A compare-and-delete would no-op anyway, but not issuing the call at
      // all keeps a departing loser off the holder's key entirely.
      const { collector, snapshots } = makeWriter(false);
      await collector.discoverQueues();
      await collector.collect();

      await collector.stop();

      expect(snapshots.releaseLease).not.toHaveBeenCalled();
    });
  });
});
