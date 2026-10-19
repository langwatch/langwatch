import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { scannedGroup, scannedQueue } from "../../../../__tests__/support/queue-scan.ts";
import { MemoryAnomalyRateTrackerRepository } from "../../../../repositories/memory/memory.anomaly-rate-tracker.repository.ts";
import { MemoryAnomalyStateRepository } from "../../../../repositories/memory/memory.anomaly-state.repository.ts";
import { MemoryOpsStore } from "../../../../repositories/memory/memory.ops.store.ts";
import { RedisOpsMetricsRepository } from "../../../../repositories/redis/redis.ops-metrics.repository.ts";
import { ANOMALY_DETECTION_KILL_SWITCH_FLAG } from "../../../../rules/anomaly-constants.rules.ts";
import { AnomalyDetectorService } from "../../../../services/anomaly-detector.service.ts";
import { OpsMetricsCollectorService } from "../ops-metrics-collector.service.ts";
import { OpsMetricsTestAdapter } from "./ops-metrics.fixture.ts";

/** A client that never connects; only what the writer's cycle reads is answered. */
function metricsRedis(): Redis {
  const redis = new Redis({ lazyConnect: true, enableOfflineQueue: false });
  const pipeline = redis.pipeline();
  vi.spyOn(redis, "pipeline").mockReturnValue(pipeline);
  vi.spyOn(pipeline, "exec").mockResolvedValue([]);
  vi.spyOn(redis, "info").mockResolvedValue("");
  vi.spyOn(redis, "zrange").mockResolvedValue([]);
  vi.spyOn(redis, "smembers").mockResolvedValue([]);
  vi.spyOn(redis, "get").mockResolvedValue(null);
  vi.spyOn(redis, "set").mockResolvedValue("OK");
  return redis;
}

/** The writer and the detector over one memory store, on a clock the test moves. */
function fleet(featureFlags?: Pick<FeatureFlagApi, "isEnabled">) {
  const clock = { now: Date.UTC(2026, 8, 23, 12, 0, 0) };
  const store = MemoryOpsStore.create();
  const rateTracker = MemoryAnomalyRateTrackerRepository.create({ store, now: () => clock.now });
  const ops = OpsMetricsTestAdapter.create();
  ops.setQueueNames(["{trace_processing}"]);
  const writer = OpsMetricsCollectorService.create({
    metrics: RedisOpsMetricsRepository.create({ redis: metricsRedis() }),
    ops,
    rateTracker,
    featureFlags,
    snapshots: null,
  });
  const detector = AnomalyDetectorService.create({
    rateTracker,
    anomalyState: MemoryAnomalyStateRepository.create({ store }),
  });

  const scanOnce = async (backlogs: Record<string, number>) => {
    ops.setQueues([
      scannedQueue({
        name: "{trace_processing}",
        groups: Object.entries(backlogs).map(([tenantId, pendingJobs]) =>
          scannedGroup({ groupId: `${tenantId}/trace/handler/trace:t1`, pendingJobs }),
        ),
      }),
    ]);
    await writer.collect();
  };

  const nextMinute = () => {
    clock.now += 60_000;
  };

  return { writer, detector, rateTracker, store, scanOnce, nextMinute };
}

describe("the queue-metrics writer feeding anomaly detection", () => {
  describe("given two tenants whose jobs arrive after the writer's first scan", () => {
    describe("when the writer's next cycle runs", () => {
      /** @scenario "The queue-metrics writer records each tenant's arrivals from its scans" */
      it("makes both tenants active with their arrivals as this minute's count", async () => {
        const { writer, rateTracker, scanOnce } = fleet();
        await writer.discoverQueues();

        await scanOnce({});
        await scanOnce({ proj_a: 4, proj_b: 9 });

        expect((await rateTracker.findActiveTenants()).toSorted()).toEqual(["proj_a", "proj_b"]);
        expect(await rateTracker.currentWindowCount("proj_a", 60)).toBe(4);
        expect(await rateTracker.currentWindowCount("proj_b", 60)).toBe(9);
      });
    });
  });

  describe("given a tenant with a large backlog that neither grows nor drains", () => {
    describe("when the writer scans a minute's worth of cycles", () => {
      /** @scenario "A constant backlog with no arrivals records nothing" */
      it("records nothing for that tenant", async () => {
        const { writer, rateTracker, scanOnce } = fleet();
        await writer.discoverQueues();

        for (let cycle = 0; cycle < 30; cycle++) {
          await scanOnce({ proj_parked: 5000 });
        }

        expect(await rateTracker.currentWindowCount("proj_parked", 60)).toBe(0);
        expect(await rateTracker.findActiveTenants()).toEqual([]);
      });
    });
  });

  describe("given two hours of steady arrivals for one tenant and a quiet neighbour", () => {
    describe("when the tenant's arrivals jump tenfold for five minutes", () => {
      /** @scenario "An arrival spike the writer sees surfaces through the detector" */
      it("surfaces a surface-tier anomaly for that tenant only", async () => {
        const { writer, detector, store, scanOnce, nextMinute } = fleet();
        await writer.discoverQueues();
        for (let minute = 0; minute < 120; minute++) {
          await scanOnce({});
          await scanOnce({ proj_runaway: 10, proj_quiet: 10 });
          nextMinute();
        }

        for (let minute = 0; minute < 5; minute++) {
          await scanOnce({});
          await scanOnce({ proj_runaway: 100, proj_quiet: 10 });
          if (minute < 4) nextMinute();
        }
        const result = await detector.tick();

        expect(result.surfaced).toBe(1);
        expect(store.anomalies.get("rate_breaker:proj_runaway")?.tier).toBe("surface");
        expect(store.anomalies.get("rate_breaker:proj_quiet")).toBeUndefined();
      });
    });
  });

  describe("given the anomaly kill switch is on for one tenant", () => {
    /**
     * @scenario "Kill-switch FF keeps a killed tenant's backlog out of the rate tracker"
     * @scenario "A killed tenant's backlog is not counted by the rate tracker"
     */
    it("counts only the tenant whose switch is off", async () => {
      const isEnabled = vi.fn<FeatureFlagApi["isEnabled"]>(
        async (_key, target) => target.kind === "project" && target.projectId === "proj_killed",
      );
      const { writer, rateTracker, scanOnce } = fleet(
        createApiFixture<FeatureFlagApi>({ isEnabled }, "writer flags"),
      );
      await writer.discoverQueues();

      await scanOnce({});
      await scanOnce({ proj_killed: 4, proj_open: 9 });

      expect(await rateTracker.findActiveTenants()).toEqual(["proj_open"]);
      expect(isEnabled).toHaveBeenCalledWith(ANOMALY_DETECTION_KILL_SWITCH_FLAG, {
        kind: "project",
        projectId: "proj_killed",
      });
    });

    /** @scenario "A killed tenant's backlog is not counted by the rate tracker" */
    it("counts the tenant when the flag lookup fails", async () => {
      const isEnabled = vi.fn<FeatureFlagApi["isEnabled"]>(async () => {
        throw new Error("flags down");
      });
      const { writer, rateTracker, scanOnce } = fleet(
        createApiFixture<FeatureFlagApi>({ isEnabled }, "writer flags"),
      );
      await writer.discoverQueues();

      await scanOnce({});
      await scanOnce({ proj_open: 3 });

      expect(await rateTracker.findActiveTenants()).toEqual(["proj_open"]);
    });
  });
});
