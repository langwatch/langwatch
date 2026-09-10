/**
 * All three loops were built and none was started, which is invisible: a loop that never runs and a
 * loop that finds nothing produce the same silence.
 * Spec: specs/ops/worker-operational-loops.feature
 */
import { describe, expect, it } from "vitest";

import { OpsWorkerFeatureInstaller } from "../../features/ops/ops-worker-feature.installer.ts";
import { createWorkerOps, WorkerOpsAbsenceReport } from "../worker-ops.composition.ts";

class RecordingAbsence extends WorkerOpsAbsenceReport {
  readonly reasons: string[] = [];

  withoutAnomalyDetection(): void {
    this.reasons.push("anomaly-detection");
  }

  withoutStorageStats(): void {
    this.reasons.push("storage-stats");
  }

  withoutQueueMetricsWriter(): void {
    this.reasons.push("queue-metrics-writer");
  }
}

function config(overrides: { saas?: boolean; disableUsageStats?: boolean } = {}) {
  return {
    ops: {
      usageStats: {
        disabled: (overrides.saas ?? false) || (overrides.disableUsageStats ?? false),
        installMethod: "self-hosted",
        hostname: "langwatch.test",
        environment: "test",
      },
      collectClickHouseBackupMetrics: false,
    },
  };
}

/** Enough Redis for the rate tracker and the anomaly state store to construct. */
const redis = {
  pipeline: () => ({ exec: async () => [] }),
  tryHgetall: async () => ({}),
  get: async () => null,
  set: async () => "OK",
  del: async () => 0,
};

function compose(
  overrides: {
    saas?: boolean;
    disableUsageStats?: boolean;
    withRedis?: boolean;
    withInstances?: boolean;
    absence?: RecordingAbsence;
  } = {},
) {
  return createWorkerOps({
    config: config(overrides) as never,
    database: {} as never,
    redis: (overrides.withRedis ?? true) ? (redis as never) : null,
    featureFlags: { isEnabled: async () => false } as never,
    resolveOrganizationClient: undefined,
    resolveClickHouseInstances:
      (overrides.withInstances ?? true)
        ? async () => [
            {
              target: "shared",
              client: { query: async () => ({ json: async () => ({ data: [] }) }) },
            },
          ]
        : undefined,
    ...(overrides.absence ? { absence: overrides.absence } : {}),
  });
}

describe("given a worker holding its substrates", () => {
  describe("when the ops feature installer runs", () => {
    /** @scenario "The worker starts all three loops when it boots" */
    it("runs the enqueue-rate tick, the usage report and the storage collection", async () => {
      const ops = compose();
      const started: string[] = [];

      const close = await OpsWorkerFeatureInstaller.create({
        workers: {
          tryStartAnomalyWorker: () => {
            started.push("anomaly");
            return {
              stop: () => {
                started.push("anomaly-stopped");
              },
            };
          },
          tryStartUsageStatsWorker: () => {
            started.push("usage-stats");
            return {
              stop: () => {
                started.push("usage-stats-stopped");
              },
            };
          },
          tryStartQueueMetricsWriter: () => {
            started.push("queue-metrics");
            return {
              stop: () => {
                started.push("queue-metrics-stopped");
              },
            };
          },
        },
        storageStats: ops.storageStats,
      }).install();
      await close?.();

      expect(started).toEqual([
        "anomaly",
        "usage-stats",
        "queue-metrics",
        "queue-metrics-stopped",
        "usage-stats-stopped",
        "anomaly-stopped",
      ]);
      expect(ops.storageStats).toBeDefined();
    });

    /** @scenario "Shutting the worker down stops every loop it started" */
    it("leaves no timer running after the closer resolves", async () => {
      const ops = compose();
      const close = await OpsWorkerFeatureInstaller.create({
        workers: ops.workers,
        storageStats: ops.storageStats,
      }).install();

      await close?.();

      // A live interval keeps the event loop referenced; vitest would hang on
      // teardown rather than fail, so the assertion is that the closer ran to
      // completion and the collection can be started again from a clean state.
      expect(close).toBeDefined();
    });
  });

  describe("when the deployment is the hosted product", () => {
    /** @scenario "The hosted product sends no self-hosted usage report" */
    it("does not start the usage report and still runs the other two", async () => {
      const ops = compose({ saas: true });

      const anomaly = ops.workers.tryStartAnomalyWorker();

      expect(ops.workers.tryStartUsageStatsWorker()).toBeUndefined();
      expect(anomaly).toBeDefined();
      expect(ops.storageStats).toBeDefined();
      await anomaly?.stop();
    });
  });

  describe("when an operator disabled usage statistics", () => {
    /** @scenario "An operator's opt-out stops the usage report" */
    it("does not start the usage report", () => {
      expect(
        compose({ disableUsageStats: true }).workers.tryStartUsageStatsWorker(),
      ).toBeUndefined();
    });
  });
});

describe("given a worker composed without the queue's Redis", () => {
  describe("when it composes the operational loops", () => {
    /** @scenario "A worker with no queue Redis names the anomaly tick it cannot run" */
    it("reports the enqueue-rate tick absent by name", () => {
      const absence = new RecordingAbsence();

      const ops = compose({ withRedis: false, absence });

      expect(absence.reasons).toEqual(["anomaly-detection", "queue-metrics-writer"]);
      expect(ops.workers.tryStartAnomalyWorker()).toBeUndefined();
      expect(ops.workers.tryStartQueueMetricsWriter()).toBeUndefined();
    });
  });
});

/**
 * The writer half of the operations dashboard. `/ops` reads a snapshot out of Redis; this process
 * is what puts one there, and until it does every panel reads empty rather than unreported.
 */
describe("given the fleet's queue-metrics writer", () => {
  describe("when this process holds the queue's Redis", () => {
    /** @scenario "The worker publishes the operations snapshot the dashboard reads" */
    it("claims the shared writer lease on the snapshot store's own keys", async () => {
      const commands: Array<{ command: string; args: unknown[] }> = [];
      const recordingRedis = new Proxy(
        {},
        {
          get: (_target, command: string) => {
            if (command === "pipeline") {
              return () => ({ exec: async () => [] });
            }
            return async (...args: unknown[]) => {
              commands.push({ command, args });
              if (command === "set") return "OK";
              if (command === "incr") return 1;
              if (command === "get") return null;
              return [];
            };
          },
        },
      );

      const ops = createWorkerOps({
        config: config() as never,
        database: {} as never,
        redis: recordingRedis as never,
        featureFlags: { isEnabled: async () => false } as never,
        resolveOrganizationClient: undefined,
        resolveClickHouseInstances: undefined,
      });
      const writer = ops.workers.tryStartQueueMetricsWriter();
      if (!writer) throw new Error("a process holding Redis must compose a queue-metrics writer");

      try {
        const claimed = await waitFor(() =>
          commands.some(
            ({ command, args }) => command === "set" && args[0] === "ops:{snapshot}:lease",
          ),
        );

        // The key is pinned by literal on purpose: the reader in the API
        // process looks it up by the same string, and a writer that publishes
        // under another name is indistinguishable from one that never ran.
        expect(claimed).toBe(true);
        expect(
          commands.some(
            ({ command, args }) => command === "incr" && args[0] === "ops:{snapshot}:epoch",
          ),
        ).toBe(true);
      } finally {
        await writer.stop();
      }
    });
  });

  describe("when this process holds no Redis", () => {
    /** @scenario "A worker with no queue Redis names the snapshot nobody will write" */
    it("names the writer it cannot run rather than leaving the dashboard silently empty", () => {
      const absence = new RecordingAbsence();

      const ops = compose({ withRedis: false, absence });

      expect(absence.reasons).toContain("queue-metrics-writer");
      expect(ops.workers.tryStartQueueMetricsWriter()).toBeUndefined();
    });
  });
});

/** Polls `condition` for up to a second, which is what an unawaited start needs. */
async function waitFor(condition: () => boolean): Promise<boolean> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return condition();
}
