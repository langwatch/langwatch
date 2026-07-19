import { describe, expect, it } from "vitest";

import { TOPIC_CLUSTERING_STALE_RUN_MS } from "../process-manager/topicClusteringProcess.definition";
import type {
  TopicClusteringRunProjectionRow,
  TopicClusteringStatusRecord,
  TopicClusteringStatusRepository,
} from "../repositories/topic-clustering-status.repository";
import { TopicClusteringStatusService } from "../topic-clustering-status.service";

const NOW = 1_800_000_000_000;
const PROJECT_ID = "project-1";

function projectionRow(
  overrides: Partial<TopicClusteringRunProjectionRow> = {},
): TopicClusteringRunProjectionRow {
  return {
    id: "topicrun_1",
    projectId: PROJECT_ID,
    CreatedAt: NOW - 1_000_000,
    UpdatedAt: NOW,
    OccurredAt: NOW,
    AcceptedAt: NOW,
    LastEventId: "event-1",
    ProjectionVersion: "1",
    LastRequestedAt: null,
    LastRequestTrigger: null,
    LastRunAt: null,
    LastRunOutcome: null,
    LastRunMode: null,
    LastRunSkippedReason: null,
    LastRunError: null,
    LastRunErrorCode: null,
    LastRunErrorUserActionable: false,
    LastRunTracesProcessed: 0,
    LastRunTopicsCount: 0,
    LastRunSubtopicsCount: 0,
    LastRunPages: 0,
    InProgressRunId: null,
    InProgressTraces: 0,
    InProgressPages: 0,
    ...overrides,
  } as TopicClusteringRunProjectionRow;
}

function serviceReading(
  record: Partial<TopicClusteringStatusRecord>,
  now: number = NOW,
) {
  const repository: TopicClusteringStatusRepository = {
    findByProjectId: async () => ({
      projection: record.projection ?? null,
      nextWakeAt: record.nextWakeAt ?? null,
    }),
  };
  return new TopicClusteringStatusService(repository, () => now);
}

describe("TopicClusteringStatusService", () => {
  describe("given a project that has never been clustered", () => {
    it("reports no run, no schedule, and nothing in flight", async () => {
      const status = await serviceReading({}).getByProjectId({
        projectId: PROJECT_ID,
      });

      expect(status).toMatchObject({
        lastRequestedAt: null,
        lastRunAt: null,
        lastRunOutcome: null,
        lastRunMode: null,
        lastRunTracesProcessed: 0,
        lastRunTopicsCount: 0,
        lastRunSubtopicsCount: 0,
        inProgress: false,
        runInFlight: false,
        nextRunAt: null,
      });
    });

    it("reports the scheduled wake once the project is bootstrapped", async () => {
      const status = await serviceReading({
        projection: projectionRow(),
        nextWakeAt: new Date(NOW + 60_000),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.nextRunAt).toBe(NOW + 60_000);
    });
  });

  describe("given a run that was requested but has recorded no outcome", () => {
    /**
     * The case the projection cannot see directly: no run_started event
     * exists, and a project small enough to cluster in one page never writes
     * an in-progress marker either.
     */
    it("reports the run as in flight", async () => {
      const status = await serviceReading({
        projection: projectionRow({ LastRequestedAt: NOW - 5_000 }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.runInFlight).toBe(true);
      expect(status.inProgress).toBe(false);
    });

    it("keeps reporting it in flight right up to the stale-run window", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRequestedAt: NOW - TOPIC_CLUSTERING_STALE_RUN_MS + 1,
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.runInFlight).toBe(true);
    });

    it("stops reporting it in flight once the scheduler would abandon it", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRequestedAt: NOW - TOPIC_CLUSTERING_STALE_RUN_MS,
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.runInFlight).toBe(false);
    });
  });

  describe("given a request that was already answered by a run", () => {
    it("reports nothing in flight", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRequestedAt: NOW - 10_000,
          LastRunAt: NOW - 1_000,
          LastRunOutcome: "completed",
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.runInFlight).toBe(false);
    });

    it("treats an outcome recorded at the request instant as answering it", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRequestedAt: NOW - 1_000,
          LastRunAt: NOW - 1_000,
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.runInFlight).toBe(false);
    });
  });

  describe("given a backlog walk between pages", () => {
    it("reports the run as in flight even though no request is outstanding", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRequestedAt: NOW - 10_000,
          LastRunAt: NOW - 5_000,
          InProgressRunId: "20260717",
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.inProgress).toBe(true);
      expect(status.runInFlight).toBe(true);
    });
  });

  describe("given a completed run", () => {
    it("passes through the run's mode and counts", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRunAt: NOW - 1_000,
          LastRunOutcome: "completed",
          LastRunMode: "incremental",
          LastRunTracesProcessed: 120,
          LastRunTopicsCount: 8,
          LastRunSubtopicsCount: 30,
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status).toMatchObject({
        lastRunOutcome: "completed",
        lastRunMode: "incremental",
        lastRunTracesProcessed: 120,
        lastRunTopicsCount: 8,
        lastRunSubtopicsCount: 30,
      });
    });
  });

  describe("given a run that failed for a reason the customer can fix", () => {
    it("passes the failure code and its actionability through", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRunAt: NOW - 1_000,
          LastRunOutcome: "failed",
          LastRunError: "401 from https://internal.provider/v1 (key sk-abc...)",
          LastRunErrorCode: "model_provider_auth",
          LastRunErrorUserActionable: true,
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.lastRunErrorCode).toBe("model_provider_auth");
      expect(status.lastRunErrorUserActionable).toBe(true);
    });

    it("never exposes the raw provider error text", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRunAt: NOW - 1_000,
          LastRunOutcome: "failed",
          LastRunError: "401 from https://internal.provider/v1 (key sk-abc...)",
          LastRunErrorCode: "model_provider_auth",
          LastRunErrorUserActionable: true,
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(JSON.stringify(status)).not.toContain("sk-abc");
      expect(Object.keys(status)).not.toContain("lastRunError");
    });
  });

  describe("given a run that failed on our side", () => {
    it("reports the failure as not the customer's to fix", async () => {
      const status = await serviceReading({
        projection: projectionRow({
          LastRunAt: NOW - 1_000,
          LastRunOutcome: "failed",
          LastRunErrorCode: "clustering_service",
        }),
      }).getByProjectId({ projectId: PROJECT_ID });

      expect(status.lastRunErrorCode).toBe("clustering_service");
      expect(status.lastRunErrorUserActionable).toBe(false);
    });
  });

  describe("when the manual trigger asks whether a run is already underway", () => {
    it("answers yes while a request is outstanding", async () => {
      const service = serviceReading({
        projection: projectionRow({ LastRequestedAt: NOW - 5_000 }),
      });

      await expect(
        service.isRunInFlight({ projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });

    it("answers no once the run has reported back", async () => {
      const service = serviceReading({
        projection: projectionRow({
          LastRequestedAt: NOW - 5_000,
          LastRunAt: NOW - 1_000,
          LastRunOutcome: "completed",
        }),
      });

      await expect(
        service.isRunInFlight({ projectId: PROJECT_ID }),
      ).resolves.toBe(false);
    });
  });
});
