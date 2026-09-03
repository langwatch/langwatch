import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SNAPSHOT_VERSION,
  type DashboardData,
  type DetailSnapshot,
  type LiveSnapshot,
} from "@langwatch/ops-contract";
import { OpsSnapshotRepository } from "../../repositories/ops-snapshot.repository";
import { DefaultOpsSnapshotService } from "../ops-snapshot-reader.service";

const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  version: SNAPSHOT_VERSION,
  computedAt: 1_000,
  writerId: "pod-a",
  leaseEpoch: 7,
  queues: [
    {
      name: "trace_processing",
      displayName: "trace_processing",
      pendingGroupCount: 400,
      blockedGroupCount: 3,
      activeGroupCount: 2,
      totalPendingJobs: 145,
      dlqCount: 1,
      parkedGroupCount: 129_091,
    },
  ],
  totalGroups: 400,
  totalPendingJobs: 145,
  pendingDrift: 0,
  throughputIngestedPerSec: 317,
  completedPerSec: 375,
  failedPerSec: 0,
  totalCompleted: 10,
  totalFailed: 0,
  peakCompletedPerSec: 11_500,
  peakFailedPerSec: 0,
  peakIngestedPerSec: 66_500,
  latencyP50Ms: 3_500,
  latencyP99Ms: 18_100,
  peakLatencyP50Ms: 62_100,
  peakLatencyP99Ms: 1_445_500,
  redisMemoryUsedBytes: 1,
  redisMemoryPeakBytes: 2,
  redisMemoryMaxBytes: 3,
  redisConnectedClients: 74,
  redisEngineCpuPercent: 25.8,
  processCpuPercent: 1,
  processMemoryUsedMb: 2,
  processMemoryTotalMb: 3,
  pausedKeys: [],
  throughputHistory: [],
  ...over,
});

const detail = (over: Partial<DetailSnapshot> = {}): DetailSnapshot => ({
  version: SNAPSHOT_VERSION,
  computedAt: 900,
  writerId: "pod-a",
  leaseEpoch: 7,
  topErrors: [],
  errorClustersBound: { included: 0, total: 0 },
  parkedTenants: [
    {
      tenantId: "project_noisy",
      queueName: "trace_processing",
      groupCount: 129_000,
      oldestParkedMs: 500,
    },
  ],
  parkedTenantsBound: { included: 1, total: 1 },
  pipelineTree: [],
  phases: {
    commands: {
      pending: 0,
      active: 0,
      completedPerSec: 0,
      failedPerSec: 0,
      latencyP50Ms: 0,
      latencyP99Ms: 0,
      peakCompletedPerSec: 0,
      peakFailedPerSec: 0,
      peakLatencyP50Ms: 0,
      peakLatencyP99Ms: 0,
    },
    projections: {
      pending: 0,
      active: 0,
      completedPerSec: 0,
      failedPerSec: 0,
      latencyP50Ms: 0,
      latencyP99Ms: 0,
      peakCompletedPerSec: 0,
      peakFailedPerSec: 0,
      peakLatencyP50Ms: 0,
      peakLatencyP99Ms: 0,
    },
    reactions: {
      pending: 0,
      active: 0,
      completedPerSec: 0,
      failedPerSec: 0,
      latencyP50Ms: 0,
      latencyP99Ms: 0,
      peakCompletedPerSec: 0,
      peakFailedPerSec: 0,
      peakLatencyP50Ms: 0,
      peakLatencyP99Ms: 0,
    },
  },
  jobNameMetrics: [],
  ...over,
});

class SnapshotRepositoryStub extends OpsSnapshotRepository {
  constructor(
    private live: LiveSnapshot | null,
    private readonly detail: DetailSnapshot | null,
  ) {
    super();
  }

  setLive(snapshot: LiveSnapshot): void {
    this.live = snapshot;
  }

  async acquireOrRenewLease() {
    return { isHeld: false, epoch: 0, token: null };
  }

  async releaseLease(): Promise<void> {}

  async writeLive(): Promise<boolean> {
    return false;
  }

  async writeDetail(): Promise<boolean> {
    return false;
  }

  async tryReadLive(): Promise<LiveSnapshot | null> {
    return this.live;
  }

  async tryReadDetail(): Promise<DetailSnapshot | null> {
    return this.detail;
  }
}

async function readDashboard(input: {
  live: LiveSnapshot | null;
  detail: DetailSnapshot | null;
}): Promise<DashboardData | null> {
  const repository = new SnapshotRepositoryStub(input.live, input.detail);
  const service = DefaultOpsSnapshotService.create(repository);
  await service.start();
  const dashboard = service.tryGetDashboardData();
  service.stop();
  return dashboard;
}

describe("snapshot merging", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a live and a detail artifact", () => {
    describe("when two reader pods merge the same pair", () => {
      /** @scenario "Two reader pods serve identical dashboard data" */
      it("produces identical payloads", async () => {
        const podA = await readDashboard({ live: live(), detail: detail() });
        const podB = await readDashboard({ live: live(), detail: detail() });

        expect(podA).toEqual(podB);
      });
    });

    /** @scenario "The live artifact carries exact counts, not sampled ones" */
    it("derives the headline counts from the exact per-queue figures", async () => {
      const merged = await readDashboard({ live: live(), detail: detail() });

      expect(merged?.parkedGroups).toBe(129_091);
      expect(merged?.blockedGroups).toBe(3);
      expect(merged?.totalPendingJobs).toBe(145);
    });

    it("carries the parked tenants that explain the parked count", async () => {
      const merged = await readDashboard({ live: live(), detail: detail() });

      expect(merged?.parkedTenants).toHaveLength(1);
      expect(merged?.parkedTenants[0]?.tenantId).toBe("project_noisy");
      expect(merged?.parkedTenantsBound).toEqual({ included: 1, total: 1 });
    });

    /** @scenario "Readers surface staleness instead of hiding it" */
    it("reports the age of both artifacts and who wrote them", async () => {
      const merged = await readDashboard({ live: live(), detail: detail() });

      expect(merged?.snapshot).toEqual({
        computedAt: 1_000,
        detailComputedAt: 900,
        writerId: "pod-a",
        leaseEpoch: 7,
      });
    });
  });

  describe("given a bounded parked section", () => {
    /** @scenario "Bounded sections of the detail artifact are labelled, never silent" */
    it("reports how many exist, not just how many shipped", async () => {
      const merged = await readDashboard({
        live: live(),
        detail: detail({
          parkedTenantsBound: { included: 50, total: 213 },
        }),
      });

      expect(merged?.parkedTenantsBound.included).toBe(50);
      expect(merged?.parkedTenantsBound.total).toBe(213);
    });
  });

  describe("given no live artifact", () => {
    describe("when a reader merges", () => {
      /** @scenario "No snapshot yet renders the loading state, not an error" */
      it("returns nothing, so the page shows loading rather than zeroes", async () => {
        expect(await readDashboard({ live: null, detail: detail() })).toBeNull();
      });
    });
  });

  describe("given a live artifact but no detail yet", () => {
    it("serves the counts with empty structure rather than fabricated zeroes", async () => {
      const merged = await readDashboard({ live: live(), detail: null });

      expect(merged?.parkedGroups).toBe(129_091);
      expect(merged?.parkedTenants).toEqual([]);
      expect(merged?.topErrors).toEqual([]);
      expect(merged?.snapshot.detailComputedAt).toBeNull();
    });
  });

  it("streams the current snapshot before the next persisted update", async () => {
    vi.useFakeTimers();
    const repository = new SnapshotRepositoryStub(live(), detail());
    const service = DefaultOpsSnapshotService.create(repository);
    await service.start();
    const stream = service.streamDashboard({})[Symbol.asyncIterator]();

    const current = await stream.next();
    expect(current.value?.snapshot.computedAt).toBe(1_000);

    repository.setLive(live({ computedAt: 2_000 }));
    const update = stream.next();
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await update).value?.snapshot.computedAt).toBe(2_000);

    await stream.return?.();
    service.stop();
  });
});
