/** Spec: specs/observability/process-fleet-gauges.feature */
import {
  bindProcessFleetMetricsSource,
  unbindProcessFleetMetricsSource,
} from "@langwatch/eventing";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryProcessFleetReadingsRepository } from "../../repositories/memory/memory.process-fleet-readings.repository.ts";
import { MemoryProcessOpsRepository } from "../../repositories/memory/memory.process-ops.repository.ts";
import type { ProcessOpsRepository } from "../../repositories/process-ops.repository.ts";
import { ProcessFleetCollectionService } from "../process-fleet-collection.service.ts";

const metrics = createRecordingMeterProvider();

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
    bindProcessFleetMetricsSource(() => readings.findAll());

    await ProcessFleetCollectionService.create({ fleet: counting, readings, logger }).collect();
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
    await readings.save([
      {
        processName: "p",
        instances: 3,
        overdueWakes: 0,
        pendingMessages: 0,
        overduePending: 0,
        lapsedLeases: 0,
        deadMessages: 0,
      },
    ]);
    const failing = {
      countByProcessName: async () => {
        throw new Error("db down");
      },
    } as unknown as ProcessOpsRepository;
    const { logger, lines } = createTestLogger();

    await ProcessFleetCollectionService.create({ fleet: failing, readings, logger }).collect();

    expect(await readings.findAll()).toHaveLength(1);
    expect(lines.some((line) => line.level >= 40)).toBe(true);
  });
});
