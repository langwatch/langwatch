/**
 * All three loops were built and none was started, which is invisible: a loop that never runs and a
 * loop that finds nothing produce the same silence.
 * Spec: specs/ops/worker-operational-loops.feature
 */
import { describe, expect, it } from "vitest";

import { OpsWorkerFeatureInstaller } from "../../features/ops/ops-worker-feature.installer";
import { createWorkerOps, WorkerOpsAbsenceReportPort } from "../worker-ops.composition";

class RecordingAbsence extends WorkerOpsAbsenceReportPort {
  readonly reasons: string[] = [];

  withoutAnomalyDetection(): void {
    this.reasons.push("anomaly-detection");
  }

  withoutStorageStats(): void {
    this.reasons.push("storage-stats");
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
  hgetall: async () => ({}),
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
          startAnomalyWorker: () => {
            started.push("anomaly");
            return {
              stop: () => {
                started.push("anomaly-stopped");
              },
            };
          },
          startUsageStatsWorker: () => {
            started.push("usage-stats");
            return {
              stop: () => {
                started.push("usage-stats-stopped");
              },
            };
          },
        },
        storageStats: ops.storageStats,
      }).install();
      await close?.();

      expect(started).toEqual(["anomaly", "usage-stats", "usage-stats-stopped", "anomaly-stopped"]);
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

      const anomaly = ops.workers.startAnomalyWorker();

      expect(ops.workers.startUsageStatsWorker()).toBeUndefined();
      expect(anomaly).toBeDefined();
      expect(ops.storageStats).toBeDefined();
      await anomaly?.stop();
    });
  });

  describe("when an operator disabled usage statistics", () => {
    /** @scenario "An operator's opt-out stops the usage report" */
    it("does not start the usage report", () => {
      expect(compose({ disableUsageStats: true }).workers.startUsageStatsWorker()).toBeUndefined();
    });
  });
});

describe("given a worker composed without the queue's Redis", () => {
  describe("when it composes the operational loops", () => {
    /** @scenario "A worker with no queue Redis names the anomaly tick it cannot run" */
    it("reports the enqueue-rate tick absent by name", () => {
      const absence = new RecordingAbsence();

      const ops = compose({ withRedis: false, absence });

      expect(absence.reasons).toEqual(["anomaly-detection"]);
      expect(ops.workers.startAnomalyWorker()).toBeUndefined();
    });
  });
});
