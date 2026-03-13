/**
 * Unit tests for ScenarioJobRepository.
 *
 * Covers:
 * - BullMQ state to status mapping
 * - Job normalization into ScenarioRunData format
 * - Job metadata presence (scenarioName, scenarioId, etc.)
 * - Filtering by setId and projectId
 */

import { describe, it, expect } from "vitest";
import { ScenarioRunStatus } from "../../scenarios/scenario-event.enums";
import { STALL_THRESHOLD_MS } from "../stall-detection";
import {
  mapBullMQStateToStatus,
  normalizeJob,
  ScenarioJobRepository,
} from "../scenario-job.repository";
import type { ScenarioQueueAdapter, MinimalJob } from "../scenario-job.repository";
import type { ScenarioJob } from "../scenario.queue";

function makeJob(overrides: Partial<MinimalJob> & { data: ScenarioJob }): MinimalJob {
  return {
    id: "job_1",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeJobData(overrides: Partial<ScenarioJob> = {}): ScenarioJob {
  return {
    projectId: "proj_1",
    scenarioId: "scen_1",
    scenarioName: "Angry refund request",
    target: { type: "http", referenceId: "target_1" },
    setId: "__internal__suite_1__suite",
    batchRunId: "batch_1",
    scenarioRunId: "scenariorun_test123",
    ...overrides,
  };
}

describe("mapBullMQStateToStatus()", () => {
  describe("when state is 'waiting'", () => {
    it("returns QUEUED status", () => {
      expect(mapBullMQStateToStatus("waiting")).toBe(ScenarioRunStatus.QUEUED);
    });
  });

  describe("when state is 'active'", () => {
    it("returns RUNNING status", () => {
      expect(mapBullMQStateToStatus("active")).toBe(ScenarioRunStatus.RUNNING);
    });

    describe("when jobTimestamp is provided", () => {
      it("returns RUNNING when within stall threshold", () => {
        const now = Date.now();
        const recentTimestamp = now - (STALL_THRESHOLD_MS - 1000);
        expect(
          mapBullMQStateToStatus("active", { jobTimestamp: recentTimestamp, now })
        ).toBe(ScenarioRunStatus.RUNNING);
      });

      it("returns STALLED when exceeding stall threshold", () => {
        const now = Date.now();
        const staleTimestamp = now - (STALL_THRESHOLD_MS + 1000);
        expect(
          mapBullMQStateToStatus("active", { jobTimestamp: staleTimestamp, now })
        ).toBe(ScenarioRunStatus.STALLED);
      });

      it("returns STALLED when exactly at stall threshold", () => {
        const now = Date.now();
        const exactTimestamp = now - STALL_THRESHOLD_MS;
        expect(
          mapBullMQStateToStatus("active", { jobTimestamp: exactTimestamp, now })
        ).toBe(ScenarioRunStatus.STALLED);
      });
    });

    describe("when jobTimestamp is not provided", () => {
      it("returns RUNNING for backwards compatibility", () => {
        expect(mapBullMQStateToStatus("active")).toBe(ScenarioRunStatus.RUNNING);
      });
    });
  });

  describe("when state is 'completed'", () => {
    it("returns IN_PROGRESS status", () => {
      expect(mapBullMQStateToStatus("completed")).toBe(ScenarioRunStatus.IN_PROGRESS);
    });
  });

  describe("when state is 'failed'", () => {
    it("returns ERROR status", () => {
      expect(mapBullMQStateToStatus("failed")).toBe(ScenarioRunStatus.ERROR);
    });
  });

  describe("when state is unknown", () => {
    it("defaults to QUEUED status", () => {
      expect(mapBullMQStateToStatus("delayed")).toBe(ScenarioRunStatus.QUEUED);
    });
  });
});

describe("normalizeJob()", () => {
  describe("given a waiting BullMQ job with full metadata", () => {
    const data = makeJobData();
    const job = makeJob({ id: "scenario_proj_1_scen_1_target_1_batch_1_0", data });

    it("returns scenarioId from job data", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.scenarioId).toBe("scen_1");
    });

    it("returns batchRunId from job data", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.batchRunId).toBe("batch_1");
    });

    it("returns scenarioName as name", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.name).toBe("Angry refund request");
    });

    it("returns QUEUED status for waiting state", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.status).toBe(ScenarioRunStatus.QUEUED);
    });

    it("includes targetReferenceId in metadata", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.metadata?.langwatch?.targetReferenceId).toBe("target_1");
    });

    it("uses pre-assigned scenarioRunId from job data", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.scenarioRunId).toBe("scenariorun_test123");
    });

    it("returns zero durationInMs", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.durationInMs).toBe(0);
    });

    it("returns empty messages array", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.messages).toEqual([]);
    });
  });

  describe("given a job without scenarioRunId in data (legacy)", () => {
    const data = { ...makeJobData(), scenarioRunId: undefined } as unknown as ScenarioJob;
    const job = makeJob({ id: "job_fallback", data });

    it("falls back to job ID as scenarioRunId", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.scenarioRunId).toBe("job_fallback");
    });
  });

  describe("given an active BullMQ job", () => {
    const data = makeJobData();
    const job = makeJob({ data });

    it("returns RUNNING status when job is recent", () => {
      const result = normalizeJob({ job, state: "active" });
      expect(result?.status).toBe(ScenarioRunStatus.RUNNING);
    });
  });

  describe("given an active BullMQ job with a stale timestamp", () => {
    const data = makeJobData();
    const staleTimestamp = Date.now() - STALL_THRESHOLD_MS - 1000;
    const job = makeJob({ data, timestamp: staleTimestamp });

    it("returns STALLED status", () => {
      const result = normalizeJob({ job, state: "active" });
      expect(result?.status).toBe(ScenarioRunStatus.STALLED);
    });
  });

  describe("given a job without scenarioName", () => {
    const data = makeJobData({ scenarioName: undefined });
    const job = makeJob({ data });

    it("returns null as name", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result?.name).toBeNull();
    });
  });

  describe("given a job with no data", () => {
    const job = { id: "job_1", data: null, timestamp: 0 } as unknown as MinimalJob;

    it("returns null", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result).toBeNull();
    });
  });

  describe("given a job with missing target fields", () => {
    const job = {
      id: "job_1",
      data: { scenarioId: "scen_1", batchRunId: "batch_1", target: {} } as unknown as ScenarioJob,
      timestamp: 0,
    };

    it("returns null", () => {
      const result = normalizeJob({ job, state: "waiting" });
      expect(result).toBeNull();
    });
  });
});

describe("ScenarioJobRepository", () => {
  describe("getQueuedAndActiveJobs()", () => {
    describe("given waiting and active jobs for the requested setId", () => {
      const waitingJob = makeJob({
        id: "job_waiting",
        data: makeJobData({ scenarioId: "scen_waiting" }),
      });
      const activeJob = makeJob({
        id: "job_active",
        data: makeJobData({ scenarioId: "scen_active" }),
      });

      const adapter: ScenarioQueueAdapter = {
        getJobs: async (states) => {
          if (Array.isArray(states) && states.includes("waiting")) return [waitingJob];
          if (Array.isArray(states) && states.includes("active")) return [activeJob];
          return [];
        },
      };

      it("returns normalized rows for matching jobs", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const results = await repo.getQueuedAndActiveJobs({
          setId: "__internal__suite_1__suite",
          projectId: "proj_1",
        });
        expect(results).toHaveLength(2);
        expect(results[0]?.status).toBe(ScenarioRunStatus.QUEUED);
        expect(results[1]?.status).toBe(ScenarioRunStatus.RUNNING);
      });
    });

    describe("given jobs from a different setId", () => {
      const otherJob = makeJob({
        id: "job_other",
        data: makeJobData({ setId: "__internal__other_suite__suite" }),
      });

      const adapter: ScenarioQueueAdapter = {
        getJobs: async () => [otherJob],
      };

      it("returns empty array", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const results = await repo.getQueuedAndActiveJobs({
          setId: "__internal__suite_1__suite",
          projectId: "proj_1",
        });
        expect(results).toHaveLength(0);
      });
    });

    describe("given jobs from a different projectId", () => {
      const otherProjectJob = makeJob({
        id: "job_other_proj",
        data: makeJobData({ projectId: "proj_other" }),
      });

      const adapter: ScenarioQueueAdapter = {
        getJobs: async () => [otherProjectJob],
      };

      it("returns empty array", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const results = await repo.getQueuedAndActiveJobs({
          setId: "__internal__suite_1__suite",
          projectId: "proj_1",
        });
        expect(results).toHaveLength(0);
      });
    });

    describe("given no jobs in the queue", () => {
      const adapter: ScenarioQueueAdapter = {
        getJobs: async () => [],
      };

      it("returns empty array", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const results = await repo.getQueuedAndActiveJobs({
          setId: "__internal__suite_1__suite",
          projectId: "proj_1",
        });
        expect(results).toHaveLength(0);
      });
    });
  });

  describe("getAllQueuedJobsForProject()", () => {
    describe("given waiting and active jobs across multiple sets", () => {
      const waitingJob1 = makeJob({
        id: "job_w1",
        data: makeJobData({ setId: "set_a", batchRunId: "batch_a", scenarioId: "scen_1" }),
      });
      const waitingJob2 = makeJob({
        id: "job_w2",
        data: makeJobData({ setId: "set_b", batchRunId: "batch_b", scenarioId: "scen_2" }),
      });
      const activeJob1 = makeJob({
        id: "job_a1",
        data: makeJobData({ setId: "set_a", batchRunId: "batch_a", scenarioId: "scen_3" }),
      });

      const adapter: ScenarioQueueAdapter = {
        getJobs: async (states) => {
          if (Array.isArray(states) && states.includes("waiting")) return [waitingJob1, waitingJob2];
          if (Array.isArray(states) && states.includes("active")) return [activeJob1];
          return [];
        },
      };

      it("returns normalized runs from all sets", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const { runs } = await repo.getAllQueuedJobsForProject({ projectId: "proj_1" });
        expect(runs).toHaveLength(3);
      });

      it("builds scenarioSetId map from batchRunId to setId", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const { scenarioSetIds } = await repo.getAllQueuedJobsForProject({ projectId: "proj_1" });
        expect(scenarioSetIds).toEqual({
          batch_a: "set_a",
          batch_b: "set_b",
        });
      });
    });

    describe("given an active job that also appears in waiting", () => {
      const sharedJob = makeJob({
        id: "job_shared",
        data: makeJobData({ scenarioId: "scen_dup" }),
      });

      const adapter: ScenarioQueueAdapter = {
        getJobs: async (states) => {
          if (Array.isArray(states) && states.includes("waiting")) return [sharedJob];
          if (Array.isArray(states) && states.includes("active")) return [sharedJob];
          return [];
        },
      };

      it("returns a single row and marks the shared job as active", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const { runs } = await repo.getAllQueuedJobsForProject({ projectId: "proj_1" });
        expect(runs).toHaveLength(1);
        expect(runs[0]?.status).toBe(ScenarioRunStatus.RUNNING);
      });
    });

    describe("given jobs from a different projectId", () => {
      const otherProjectJob = makeJob({
        id: "job_other",
        data: makeJobData({ projectId: "proj_other" }),
      });

      const adapter: ScenarioQueueAdapter = {
        getJobs: async () => [otherProjectJob],
      };

      it("filters them out", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const { runs, scenarioSetIds } = await repo.getAllQueuedJobsForProject({ projectId: "proj_1" });
        expect(runs).toHaveLength(0);
        expect(scenarioSetIds).toEqual({});
      });
    });

    describe("given no jobs in the queue", () => {
      const adapter: ScenarioQueueAdapter = {
        getJobs: async () => [],
      };

      it("returns empty runs and empty scenarioSetIds map", async () => {
        const repo = new ScenarioJobRepository(adapter);
        const { runs, scenarioSetIds } = await repo.getAllQueuedJobsForProject({ projectId: "proj_1" });
        expect(runs).toHaveLength(0);
        expect(scenarioSetIds).toEqual({});
      });
    });
  });
});
