/** Spec: specs/observability/process-fleet-gauges.feature */
import {
  bindProcessFleetMetricsSource,
  unbindProcessFleetMetricsSource,
} from "@langwatch/eventing";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryProcessFleetReadingsRepository } from "../../repositories/memory/memory.process-fleet-readings.repository.ts";
import { MemoryProcessOpsRepository } from "../../repositories/memory/memory.process-ops.repository.ts";
import type { ProcessOpsRepository } from "../../repositories/process-ops.repository.ts";
import {
  FLEET_READINGS_STALE_AFTER_MS,
  ProcessFleetCollectionService,
} from "../process-fleet-collection.service.ts";

const metrics = createRecordingMeterProvider();
const READING = {
  processName: "p",
  instances: 3,
  overdueWakes: 0,
  pendingMessages: 0,
  overduePending: 0,
  lapsedLeases: 0,
  deadMessages: 0,
};

describe("given the scheduled fleet collection", () => {
  beforeAll(() => metrics.install());
  afterAll(() => {
    unbindProcessFleetMetricsSource();
    metrics.uninstall();
  });

  /** @scenario "The fleet gauges read the counts the scheduled collector shared" */
  it("feeds the gauges from the shared counts, not from the tables", async () => {
    const store = MemoryOpsStore.create();
    const fleet = MemoryProcessOpsRepository.create({ store });
    const readings = MemoryProcessFleetReadingsRepository.create({ store });
    const { logger } = createTestLogger();
    let reads = 0;
    const counting: ProcessOpsRepository = Object.create(fleet, {
      countByProcessName: {
        value: (...args: Parameters<ProcessOpsRepository["countByProcessName"]>) => {
          reads += 1;
          return fleet.countByProcessName(...args);
        },
      },
    });
    store.outbox.push({
      processName: "automations",
      status: "dead",
    } as (typeof store.outbox)[number]);
    const collection = ProcessFleetCollectionService.create({ fleet: counting, readings, logger });
    bindProcessFleetMetricsSource(() => collection.currentReadings());

    await collection.collect();
    await metrics.collect();
    await metrics.collect();

    expect(reads).toBe(1);
    const dead = metrics.recorded.find(
      (r) => r.instrument === "pm_outbox_dead" && r.attributes.process_name === "automations",
    );
    expect(dead?.value).toBe(1);
  });

  /** @scenario "A failed scheduled fleet read keeps the last counts" */
  it("keeps the last counts when a read fails", async () => {
    const store = MemoryOpsStore.create();
    const readings = MemoryProcessFleetReadingsRepository.create({ store });
    await readings.save({ takenAtMs: nowInstant().epochMilliseconds, readings: [READING] });
    const failing = MemoryProcessOpsRepository.create({ store });
    failing.countByProcessName = async () => {
      throw new Error("db down");
    };
    const { logger, lines } = createTestLogger();

    await ProcessFleetCollectionService.create({ fleet: failing, readings, logger }).collect();

    expect((await readings.find())?.readings).toEqual([READING]);
    expect(lines.some((line) => line.level >= 40)).toBe(true);
  });
});

describe("given shared fleet counts older than a few collection wakes", () => {
  beforeAll(() => metrics.install());
  afterAll(() => {
    unbindProcessFleetMetricsSource();
    metrics.uninstall();
  });

  /** @scenario "Stale fleet counts report a failed collection" */
  it("reads the collection as failed and never advances its last-success time", async () => {
    const store = MemoryOpsStore.create();
    const readings = MemoryProcessFleetReadingsRepository.create({ store });
    const { logger } = createTestLogger();
    const collection = ProcessFleetCollectionService.create({
      fleet: MemoryProcessOpsRepository.create({ store }),
      readings,
      logger,
    });
    const takenAtMs = nowInstant().epochMilliseconds - FLEET_READINGS_STALE_AFTER_MS - 1;
    await readings.save({ takenAtMs, readings: [READING] });
    bindProcessFleetMetricsSource(() => collection.currentReadings());

    const before = metrics.recorded.length;
    await metrics.collect();

    const valueOf = (instrument: string) =>
      metrics.recorded.slice(before).find((r) => r.instrument === instrument)?.value;
    expect(valueOf("pm_fleet_collection_success")).toBe(0);
    expect(valueOf("pm_fleet_last_success_timestamp_seconds")).toBe(0);
    await expect(collection.currentReadings()).rejects.toThrow(/missing or stale/);
  });
});
