import { describe, expect, it, vi } from "vitest";
import { OpsMetricsCollector } from "../../metrics-collector";
import type { SnapshotRepository } from "../snapshot.repository";

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
    exec: vi.fn().mockResolvedValue([]),
  }),
  zrange: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
};

const makeQueueRepo = () => ({
  discoverQueueNames: vi.fn().mockResolvedValue(["trace_processing"]),
  scanQueues: vi.fn().mockResolvedValue([]),
  getBlockedSummary: vi
    .fn()
    .mockResolvedValue({ totalBlocked: 0, clusters: [] }),
  enumerateParkedTenants: vi.fn().mockResolvedValue({ tenants: [], total: 0 }),
  reconcileTotalPending: vi.fn().mockResolvedValue(null),
});

const makeSnapshotRepo = (held: boolean): SnapshotRepository => ({
  acquireOrRenewLease: vi.fn().mockResolvedValue({ held, epoch: 1 }),
  releaseLease: vi.fn().mockResolvedValue(undefined),
  writeLive: vi.fn().mockResolvedValue(undefined),
  writeDetail: vi.fn().mockResolvedValue(undefined),
  readLive: vi.fn().mockResolvedValue(null),
  readDetail: vi.fn().mockResolvedValue(null),
});

const makeWriter = (held: boolean) => {
  const queueRepo = makeQueueRepo();
  const snapshotRepo = makeSnapshotRepo(held);
  const collector = new OpsMetricsCollector({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redisStub as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queueRepo: queueRepo as any,
    snapshotRepo,
    writerId: held ? "holder" : "loser",
  });
  return { collector, queueRepo, snapshotRepo };
};

describe("snapshot writer lease gate", () => {
  describe("given a pod that does not hold the lease", () => {
    describe("when its collection cycle runs", () => {
      /** @scenario "Only the lease holder scans" */
      it("performs no scan at all", async () => {
        const { collector, queueRepo, snapshotRepo } = makeWriter(false);

        await collector.discoverQueues();
        await collector.collect();

        expect(queueRepo.scanQueues).not.toHaveBeenCalled();
        expect(snapshotRepo.writeLive).not.toHaveBeenCalled();
        expect(collector.isWriter()).toBe(false);
      });
    });
  });

  describe("given the pod holding the lease", () => {
    describe("when its collection cycle runs", () => {
      it("scans and publishes the live artifact", async () => {
        const { collector, queueRepo, snapshotRepo } = makeWriter(true);

        await collector.discoverQueues();
        await collector.collect();

        expect(queueRepo.scanQueues).toHaveBeenCalled();
        expect(snapshotRepo.writeLive).toHaveBeenCalled();
        expect(collector.isWriter()).toBe(true);
      });
    });
  });

  describe("given a holder shutting down cleanly", () => {
    it("hands the lease back rather than letting it lapse", async () => {
      // Waiting out the TTL on a clean shutdown leaves the whole fleet without
      // a writer for the remainder of the window — the rolling-deploy case.
      const { collector, snapshotRepo } = makeWriter(true);
      await collector.discoverQueues();
      await collector.collect();

      collector.stop();

      expect(snapshotRepo.releaseLease).toHaveBeenCalledWith({
        writerId: "holder",
      });
    });
  });

  describe("given a pod that never held the lease", () => {
    it("releases nothing on shutdown", async () => {
      // A compare-and-delete would no-op anyway, but not issuing the call at
      // all keeps a departing loser off the holder's key entirely.
      const { collector, snapshotRepo } = makeWriter(false);
      await collector.discoverQueues();
      await collector.collect();

      collector.stop();

      expect(snapshotRepo.releaseLease).not.toHaveBeenCalled();
    });
  });
});
