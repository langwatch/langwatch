/**
 * @vitest-environment node
 * @see specs/ops/worker-operational-loops.feature
 * The worker's installed list booted over `memoryStores()` wholly (ARCHITECTURE.md §7, §13): the
 * operational loops are the scheduled process managers ops hosts, read off the eventing the
 * worker mounts.
 */
import { afterEach, describe, expect, it } from "vitest";

import { bootMemoryWorker } from "./worker-memory-boot.fixture.ts";

/** The three scheduled loops ops mounts: pipeline, process manager, and the wake interval. */
const SCHEDULED_LOOPS = [
  { loop: "enqueue-rate tick", pipeline: "ops_anomaly_detection", manager: "anomalyDetection" },
  { loop: "usage report", pipeline: "ops_usage_report", manager: "usageReport" },
  { loop: "storage collection", pipeline: "ops_storage_stats", manager: "storageStats" },
] as const;

let booted: Awaited<ReturnType<typeof bootMemoryWorker>> | undefined;

afterEach(async () => {
  await booted?.runtime.stop();
  booted = void 0;
});

describe("given the worker's installed list booted for a deployment that opted out of nothing", () => {
  describe("when the ops feature installer has run", () => {
    /** @scenario "The worker starts all three loops when it boots" */
    it.each(SCHEDULED_LOOPS)(
      "mounts the $loop as a scheduled process manager on $pipeline",
      async ({ pipeline, manager }) => {
        booted = await bootMemoryWorker();

        const definition = booted.eventing.definitions.find(
          ({ metadata }) => metadata.name === pipeline,
        );
        const schedule = definition?.processManagers.get(manager)?.config.schedule;

        expect(schedule?.everyMs).toBeGreaterThan(0);
      },
    );
  });
});
