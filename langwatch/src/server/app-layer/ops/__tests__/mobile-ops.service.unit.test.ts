import { describe, expect, it, vi } from "vitest";

import type { OpsDependencies } from "~/server/app-layer/dependencies";
import type { Anomaly } from "~/server/observability/anomalyState";

import {
  MobileOpsService,
  OpsModuleUnavailableError,
} from "../mobile-ops.service";
import type { DashboardData, ThroughputPoint } from "../types";

const listAnomalies = vi.fn<() => Promise<Anomaly[]>>();

vi.mock("~/server/observability/anomalyState", () => ({
  AnomalyStateStore: class {
    list() {
      return listAnomalies();
    }
  },
}));

function throughputPoint(): ThroughputPoint {
  return {
    timestamp: 1,
    ingestedPerSec: 0,
    completedPerSec: 0,
    failedPerSec: 0,
    pendingCount: 0,
    blockedCount: 0,
    parkedCount: 0,
  };
}

/**
 * Only the fields this suite reads. The full DashboardData carries fifty-odd
 * numeric metrics that say nothing about the mapping under test.
 */
function dashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    throughputHistory: [],
    queues: [],
    pipelineTree: [],
    jobNameMetrics: [],
    pausedKeys: [],
    topErrors: [],
    ...overrides,
  } as unknown as DashboardData;
}

function createOps(overrides: Partial<OpsDependencies> = {}): OpsDependencies {
  return {
    queues: {} as OpsDependencies["queues"],
    scheduler: {} as OpsDependencies["scheduler"],
    eventExplorer: {} as OpsDependencies["eventExplorer"],
    managerExplorer: {} as OpsDependencies["managerExplorer"],
    replay: {} as OpsDependencies["replay"],
    blobStore: {} as OpsDependencies["blobStore"],
    metricsCollector: null,
    ...overrides,
  };
}

function anomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    tenantId: "tenant-1",
    kind: "rate_breaker",
    tier: "surface",
    currentRate: 10,
    baseline: 1,
    triggeredAt: 1_000,
    reason: "rate above baseline",
    ...overrides,
  };
}

describe("MobileOpsService", () => {
  describe("given the metrics collector has not completed a cycle", () => {
    describe("when the dashboard is read", () => {
      it("returns the snapshot but reports that it is not populated yet", () => {
        const service = new MobileOpsService(
          createOps({
            metricsCollector: {
              getDashboardData: () => dashboardData(),
            } as unknown as OpsDependencies["metricsCollector"],
          }),
          null,
        );

        const result = service.getDashboard();

        expect(result.hasSnapshot).toBe(false);
        expect(result.snapshot).toBeDefined();
      });
    });
  });

  describe("given the metrics collector has completed a cycle", () => {
    describe("when the dashboard is read", () => {
      it("reports that a snapshot is available", () => {
        const service = new MobileOpsService(
          createOps({
            metricsCollector: {
              getDashboardData: () =>
                dashboardData({ throughputHistory: [throughputPoint()] }),
            } as unknown as OpsDependencies["metricsCollector"],
          }),
          null,
        );

        expect(service.getDashboard().hasSnapshot).toBe(true);
      });
    });
  });

  describe("given the ops module runs without a metrics collector", () => {
    describe("when the dashboard is read", () => {
      it("refuses rather than reporting a quiet platform", () => {
        const service = new MobileOpsService(createOps(), null);

        expect(() => service.getDashboard()).toThrow(OpsModuleUnavailableError);
      });
    });

    describe("when the badge counts are read", () => {
      it("answers zero so the badge does not block the whole app", () => {
        const service = new MobileOpsService(createOps(), null);

        const counts = service.getBadgeCounts();

        expect(counts.blockedCount).toBe(0);
        expect(counts.dlqCount).toBe(0);
        expect(() => new Date(counts.computedAt).toISOString()).not.toThrow();
      });
    });
  });

  describe("when the badge counts are read", () => {
    it("serializes the computation time as an ISO string", () => {
      const computedAt = new Date("2026-01-02T03:04:05.000Z");
      const service = new MobileOpsService(
        createOps({
          metricsCollector: {
            getBadgeCounts: () => ({ blockedCount: 3, dlqCount: 7, computedAt }),
          } as unknown as OpsDependencies["metricsCollector"],
        }),
        null,
      );

      expect(service.getBadgeCounts()).toEqual({
        blockedCount: 3,
        dlqCount: 7,
        computedAt: "2026-01-02T03:04:05.000Z",
      });
    });
  });

  describe("given anomalies in both tiers", () => {
    describe("when anomalies are listed", () => {
      it("puts hard-tier anomalies first, then the most recent", async () => {
        listAnomalies.mockResolvedValue([
          anomaly({ tenantId: "surface-old", triggeredAt: 1 }),
          anomaly({ tenantId: "hard", tier: "hard", triggeredAt: 1 }),
          anomaly({ tenantId: "surface-new", triggeredAt: 99 }),
        ]);
        const service = new MobileOpsService(
          createOps(),
          {} as never,
        );

        const result = await service.getAnomalies();

        expect(result.map((a) => a.tenantId)).toEqual([
          "hard",
          "surface-new",
          "surface-old",
        ]);
      });
    });
  });

  describe("given no redis connection", () => {
    describe("when anomalies are listed", () => {
      it("returns nothing instead of failing the screen", async () => {
        const service = new MobileOpsService(createOps(), null);

        await expect(service.getAnomalies()).resolves.toEqual([]);
      });
    });
  });

  describe("when the foundry catalog is read", () => {
    it("returns every built-in preset with a name and a description", () => {
      const service = new MobileOpsService(createOps(), null);

      const presets = service.getFoundryPresets();

      expect(presets.length).toBeGreaterThan(0);
      for (const preset of presets) {
        expect(preset.name).not.toBe("");
        expect(preset.description).not.toBe("");
      }
    });

    it("counts spans across the whole tree, not just the roots", () => {
      const service = new MobileOpsService(createOps(), null);

      const presets = service.getFoundryPresets();
      const nested = presets.find((p) => p.spans.some((s) => s.children.length));

      expect(nested).toBeDefined();
      expect(nested!.spanCount).toBeGreaterThan(nested!.spans.length);
    });

    it("carries no message bodies or attributes into the catalog", () => {
      const service = new MobileOpsService(createOps(), null);

      const spanKeys = new Set<string>();
      const walk = (spans: { children: unknown[] }[]) => {
        for (const span of spans) {
          for (const key of Object.keys(span)) spanKeys.add(key);
          walk(span.children as { children: unknown[] }[]);
        }
      };
      walk(service.getFoundryPresets().flatMap((p) => p.spans));

      expect([...spanKeys].sort()).toEqual([
        "children",
        "durationMs",
        "model",
        "name",
        "status",
        "type",
      ]);
    });
  });

  describe("given a group whose jobs carry customer payloads", () => {
    describe("when the group's jobs are read", () => {
      it("reports the payload shape and size but never its contents", async () => {
        const getGroupJobs = vi.fn().mockResolvedValue({
          jobs: [
            {
              jobId: "job-1",
              score: 5,
              data: { traceId: "t-1", prompt: "a customer secret" },
            },
            { jobId: "job-2", score: 6, data: null },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        });
        const service = new MobileOpsService(
          createOps({
            queues: { getGroupJobs } as unknown as OpsDependencies["queues"],
          }),
          null,
        );

        const result = await service.getGroupJobs({
          queueName: "q",
          groupId: "g",
          page: 1,
          pageSize: 20,
        });

        expect(result.jobs[0]).toEqual({
          jobId: "job-1",
          score: 5,
          payloadKeys: ["prompt", "traceId"],
          payloadBytes: 46,
        });
        expect(result.jobs[1]).toEqual({
          jobId: "job-2",
          score: 6,
          payloadKeys: [],
          payloadBytes: 0,
        });
        expect(JSON.stringify(result)).not.toContain("a customer secret");
      });
    });
  });

  describe("when a payload store sweep is run", () => {
    it("passes the trial flag and the opaque actor id straight through", async () => {
      const runCleanup = vi.fn().mockResolvedValue({ totals: { reclaimed: 0 } });
      const service = new MobileOpsService(
        createOps({
          blobStore: { runCleanup } as unknown as OpsDependencies["blobStore"],
        }),
        null,
      );

      await service.runBlobSweep({ dryRun: true, requestedBy: "user-abc" });

      expect(runCleanup).toHaveBeenCalledWith({
        dryRun: true,
        requestedBy: "user-abc",
      });
    });
  });
});
