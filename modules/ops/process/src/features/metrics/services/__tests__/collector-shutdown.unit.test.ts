import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { MemoryAnomalyRateTrackerRepository } from "../../../../repositories/memory/memory.anomaly-rate-tracker.repository.ts";
import { MemoryOpsStore } from "../../../../repositories/memory/memory.ops.store.ts";
import { RedisOpsMetricsRepository } from "../../../../repositories/redis/redis.ops-metrics.repository.ts";
import { OpsMetricsCollectorService } from "../ops-metrics-collector.service.ts";
import { OpsMetricsTestAdapter } from "./ops-metrics.fixture.ts";

function createMockRedis() {
  return redisDouble({
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
  });
}

/** A drift read that holds until released, standing in for a slow Redis round trip. */
class HeldDriftAdapter extends OpsMetricsTestAdapter {
  entered = false;
  private release: () => void = () => undefined;
  private readonly held = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  static createHeld(): HeldDriftAdapter {
    return new HeldDriftAdapter();
  }

  override async readQueuePendingDrift(): Promise<number> {
    this.entered = true;
    await this.held;
    return super.readQueuePendingDrift();
  }

  finish(): void {
    this.release();
  }
}

function collectorOver(ops: OpsMetricsTestAdapter): OpsMetricsCollectorService {
  return OpsMetricsCollectorService.create({
    metrics: RedisOpsMetricsRepository.create({ redis: createMockRedis() }),
    ops,
    rateTracker: MemoryAnomalyRateTrackerRepository.create({ store: MemoryOpsStore.create() }),
  });
}

describe("OpsMetricsCollectorService shutdown", () => {
  describe("given a writer whose start has not finished", () => {
    describe("when it stops", () => {
      /** @scenario "A writer stopped while still starting arms no timers" */
      it("runs no scan or reconcile after stop returns", async () => {
        const ops = OpsMetricsTestAdapter.create();
        ops.setQueueNames(["queue-alpha"]);
        const collector = collectorOver(ops);

        void collector.start();
        await collector.stop();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(ops.getScanCalls()).toBe(0);
        expect(ops.getDriftReads()).toBe(0);
      });
    });
  });

  describe("given a reconcile still in flight", () => {
    describe("when it stops", () => {
      /** @scenario "Shutdown waits for a tick already talking to Redis" */
      it("returns only after that reconcile has finished", async () => {
        const ops = HeldDriftAdapter.createHeld();
        ops.setQueueNames(["queue-alpha"]);
        const collector = collectorOver(ops);
        await collector.start();
        await vi.waitFor(() => expect(ops.entered).toBe(true));

        let stopped = false;
        const stopping = collector.stop().then(() => {
          stopped = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(stopped).toBe(false);

        ops.finish();
        await stopping;
        expect(stopped).toBe(true);
      });
    });
  });
});
