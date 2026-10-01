import Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { MemoryAnomalyRateTrackerRepository } from "../../repositories/memory/memory.anomaly-rate-tracker.repository.ts";
import { MemoryAnomalyStateRepository } from "../../repositories/memory/memory.anomaly-state.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { RedisOpsMetricsRepository } from "../../repositories/redis/redis.ops-metrics.repository.ts";
import { AnomalyDetectorService } from "../anomaly-detector.service.ts";
import { OpsMetricsCollectorService } from "../ops-metrics-collector.service.ts";
import { OpsMetricsTestAdapter } from "./ops-metrics.fixture.ts";
import { scannedGroup, scannedQueue } from "./support/queue-scan.ts";

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
function fleet() {
  const clock = { now: Date.UTC(2026, 8, 23, 12, 0, 0) };
  const store = MemoryOpsStore.create();
  const rateTracker = MemoryAnomalyRateTrackerRepository.create({ store, now: () => clock.now });
  const ops = OpsMetricsTestAdapter.create();
  ops.setQueueNames(["{trace_processing}"]);
  const writer = OpsMetricsCollectorService.create({
    metrics: RedisOpsMetricsRepository.create({ redis: metricsRedis() }),
    ops,
    rateTracker,
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
  describe("given a scan holding waiting jobs for two tenants", () => {
    describe("when the writer's cycle runs", () => {
      /** @scenario "The queue-metrics writer records each tenant's waiting jobs from its scan" */
      it("makes both tenants active for the detector", async () => {
        const { writer, rateTracker, scanOnce } = fleet();
        await writer.discoverQueues();

        await scanOnce({ proj_a: 4, proj_b: 9 });

        expect((await rateTracker.findActiveTenants()).toSorted()).toEqual(["proj_a", "proj_b"]);
        expect(await rateTracker.currentWindowCount("proj_a", 60)).toBe(4);
        expect(await rateTracker.currentWindowCount("proj_b", 60)).toBe(9);
      });
    });
  });

  describe("given a job still waiting on the next cycle", () => {
    describe("when the writer scans twice", () => {
      /** @scenario "A job waiting across cycles is counted in every cycle, where main counted it once at enqueue" */
      it("counts it in both cycles", async () => {
        const { writer, rateTracker, scanOnce } = fleet();
        await writer.discoverQueues();

        await scanOnce({ proj_a: 1 });
        await scanOnce({ proj_a: 1 });

        expect(await rateTracker.currentWindowCount("proj_a", 60)).toBe(2);
      });
    });
  });

  describe("given two hours of steady backlog for one tenant and a quiet neighbour", () => {
    describe("when the tenant's backlog jumps tenfold for five minutes", () => {
      /** @scenario "A backlog spike the writer sees surfaces through the detector" */
      it("surfaces a surface-tier anomaly for that tenant only", async () => {
        const { writer, detector, store, scanOnce, nextMinute } = fleet();
        await writer.discoverQueues();
        for (let minute = 0; minute < 120; minute++) {
          await scanOnce({ proj_runaway: 10, proj_quiet: 10 });
          nextMinute();
        }

        for (let minute = 0; minute < 5; minute++) {
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
});
