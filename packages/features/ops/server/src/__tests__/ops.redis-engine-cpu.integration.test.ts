/**
 * The engine-CPU percent an operator reads is derived across two collection
 * cycles, not from one INFO reading: the collector diffs the main-thread CPU
 * counters against the previous sample and the dashboard view carries the
 * result. Spec: specs/ops/redis-pressure.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsLatencyHistograms, OpsQueueTotals } from "../repositories/ops-metrics.repository";
import { OpsMetricsRepository } from "../repositories/ops-metrics.repository";
import { OpsMetricsCollectorService } from "../services/ops-metrics-collector.service";
import { OpsMetricsTestAdapter } from "../services/__tests__/ops-metrics.fixture";

/** Answers every read the collect cycle makes, with one INFO text per cycle. */
class ScriptedMetricsRepository extends OpsMetricsRepository {
  private infoTexts: string[];

  constructor(infoTexts: string[]) {
    super();
    this.infoTexts = [...infoTexts];
  }

  readServerInfo(): Promise<string> {
    return Promise.resolve(this.infoTexts.shift() ?? "");
  }

  readLatencyHistograms(): Promise<OpsLatencyHistograms> {
    return Promise.resolve({ minute: [], hourByQueue: [], allTime: [] });
  }

  readQueueTotals(): Promise<OpsQueueTotals[]> {
    return Promise.resolve([]);
  }

  readLatencySamplesMs(): Promise<number[]> {
    return Promise.resolve([]);
  }

  readJobNameTotals(): Promise<Map<string, OpsQueueTotals>> {
    return Promise.resolve(new Map());
  }

  readPausedJobKeys(): Promise<string[]> {
    return Promise.resolve([]);
  }

  tryReadPersistedState(): Promise<string | null> {
    return Promise.resolve(null);
  }

  writePersistedState(): Promise<void> {
    return Promise.resolve();
  }

  recordKnownPipelinePaths(): Promise<void> {
    return Promise.resolve();
  }

  readKnownPipelinePaths(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

const infoText = (args: { userSec: number; sysSec: number }): string =>
  [
    "used_memory:3200000000",
    "used_memory_human:2.98G",
    "used_memory_peak:10500000000",
    "used_memory_peak_human:9.78G",
    "maxmemory:10400000000",
    "connected_clients:24",
    `used_cpu_user_main_thread:${args.userSec}`,
    `used_cpu_sys_main_thread:${args.sysSec}`,
  ].join("\r\n");

const collectorOver = (infoTexts: string[]): OpsMetricsCollectorService =>
  OpsMetricsCollectorService.create({
    metrics: new ScriptedMetricsRepository(infoTexts),
    ops: OpsMetricsTestAdapter.create(),
    snapshots: null,
    writerId: "test-writer",
  });

describe("Redis engine CPU on the dashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the collector has sampled Redis INFO cpu twice, 1000ms apart", () => {
    describe("when the dashboard data is built", () => {
      /** @scenario Engine CPU percent is derived from two successive INFO snapshots */
      it("reports the main-thread percent the two snapshots imply", async () => {
        const collector = collectorOver([
          infoText({ userSec: 10, sysSec: 5 }),
          infoText({ userSec: 10.3, sysSec: 5.1 }),
        ]);

        await collector.collect();
        expect(collector.getDashboardData().redisEngineCpuPercent).toBeNull();

        vi.advanceTimersByTime(1_000);
        await collector.collect();

        expect(collector.getDashboardData().redisEngineCpuPercent).toBe(40);
      });
    });
  });
});
