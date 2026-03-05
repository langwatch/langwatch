/**
 * @vitest-environment node
 *
 * Integration tests for ScenarioEventService.
 * Tests the service's ability to properly handle scenario run data,
 * including edge cases like runs without MESSAGE_SNAPSHOT events.
 */
import type { Project } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ScenarioEventType,
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { ScenarioEventService } from "~/server/scenarios/scenario-event.service";
import { prisma } from "~/server/db";
import { esClient, SCENARIO_EVENTS_INDEX } from "~/server/elasticsearch";
import { getTestProject } from "~/utils/testUtils";

// Mock the logger to avoid console noise in tests
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

/**
 * Helper function to clean up scenario events for test projects
 */
async function cleanupScenarioEvents(projectIds: string[]) {
  try {
    const client = await esClient({ test: true });
    await client.deleteByQuery({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            should: projectIds.map((id) => ({ term: { project_id: id } })),
          },
        },
      },
      conflicts: "proceed",
    });
  } catch (error) {
    console.warn("Failed to clean up scenario events:", error);
  }
}

/**
 * Helper to generate unique IDs for test isolation
 */
function generateTestIds(prefix: string) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return {
    scenarioId: `${prefix}-scenario-${timestamp}-${random}`,
    scenarioRunId: `scenariorun_${prefix}-${timestamp}-${random}`,
    batchRunId: `scenariobatch_${prefix}-${timestamp}-${random}`,
    scenarioSetId: `${prefix}-set-${timestamp}-${random}`,
  };
}

describe("ScenarioEventService Integration Tests", () => {
  let project: Project;
  let service: ScenarioEventService;

  beforeAll(async () => {
    const timestamp = Date.now();
    project = await getTestProject(`scenario-event-service-test-${timestamp}`);
    service = new ScenarioEventService();
  });

  afterAll(async () => {
    await cleanupScenarioEvents([project.id]);
    await prisma.project.delete({ where: { id: project.id } });
  });

  beforeEach(async () => {
    await cleanupScenarioEvents([project.id]);
  });

  describe("getScenarioRunDataBatch", () => {
    it("should return run data with correct timestamp when MESSAGE_SNAPSHOT exists", async () => {
      const client = await esClient({ test: true });
      const ids = generateTestIds("with-message");
      const runStartedTimestamp = Date.now() - 10000;
      const messageTimestamp = Date.now() - 5000;
      const runFinishedTimestamp = Date.now();

      // Create test events: RUN_STARTED, MESSAGE_SNAPSHOT, RUN_FINISHED
      const events = [
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: runStartedTimestamp,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          metadata: { name: "Test Scenario", description: "Test description" },
        },
        {
          type: ScenarioEventType.MESSAGE_SNAPSHOT,
          timestamp: messageTimestamp,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          messages: [{ id: "msg1", role: "user", content: "Hello" }],
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: runFinishedTimestamp,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          status: ScenarioRunStatus.SUCCESS,
          results: { verdict: Verdict.SUCCESS },
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      // Call the service method
      const runs = await service.getScenarioRunDataBatch({
        projectId: project.id,
        scenarioRunIds: [ids.scenarioRunId],
      });

      expect(runs).toHaveLength(1);
      const run = runs[0]!;

      // Should use MESSAGE_SNAPSHOT timestamp when available
      expect(run.timestamp).toBe(messageTimestamp);
      expect(run.scenarioRunId).toBe(ids.scenarioRunId);
      expect(run.batchRunId).toBe(ids.batchRunId);
      expect(run.status).toBe(ScenarioRunStatus.SUCCESS);
      expect(run.messages).toHaveLength(1);
      expect(run.name).toBe("Test Scenario");
    });

    it("should use runStartedEvent timestamp when MESSAGE_SNAPSHOT is missing", async () => {
      const client = await esClient({ test: true });
      const ids = generateTestIds("no-message");
      const runStartedTimestamp = Date.now() - 10000;
      const runFinishedTimestamp = Date.now();

      // Create test events: RUN_STARTED and RUN_FINISHED only (no MESSAGE_SNAPSHOT)
      // This simulates a scenario that failed early before any messages were exchanged
      const events = [
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: runStartedTimestamp,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          metadata: { name: "Failed Early Scenario", description: "Test" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: runFinishedTimestamp,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          status: ScenarioRunStatus.ERROR,
          results: { verdict: Verdict.FAILURE },
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      // Call the service method
      const runs = await service.getScenarioRunDataBatch({
        projectId: project.id,
        scenarioRunIds: [ids.scenarioRunId],
      });

      expect(runs).toHaveLength(1);
      const run = runs[0]!;

      // Should fallback to RUN_STARTED timestamp when MESSAGE_SNAPSHOT is missing
      expect(run.timestamp).toBe(runStartedTimestamp);
      expect(run.scenarioRunId).toBe(ids.scenarioRunId);
      expect(run.status).toBe(ScenarioRunStatus.ERROR);
      expect(run.messages).toEqual([]);
      expect(run.name).toBe("Failed Early Scenario");
    });

    it("should return empty array when no RUN_STARTED event exists", async () => {
      const client = await esClient({ test: true });
      const ids = generateTestIds("no-start");

      // Create only MESSAGE_SNAPSHOT (no RUN_STARTED - shouldn't happen but testing edge case)
      const events = [
        {
          type: ScenarioEventType.MESSAGE_SNAPSHOT,
          timestamp: Date.now(),
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          messages: [{ id: "msg1", role: "user", content: "Hello" }],
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      // Call the service method
      const runs = await service.getScenarioRunDataBatch({
        projectId: project.id,
        scenarioRunIds: [ids.scenarioRunId],
      });

      // Should skip runs without RUN_STARTED event
      expect(runs).toHaveLength(0);
    });

    it("should handle multiple runs with mixed message states correctly", async () => {
      const client = await esClient({ test: true });
      const ids1 = generateTestIds("multi-with");
      const ids2 = generateTestIds("multi-without");

      const timestamp1Start = Date.now() - 20000;
      const timestamp1Message = Date.now() - 15000;
      const timestamp2Start = Date.now() - 10000;

      const events = [
        // Run 1: Has MESSAGE_SNAPSHOT
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: timestamp1Start,
          project_id: project.id,
          scenario_id: ids1.scenarioId,
          scenario_run_id: ids1.scenarioRunId,
          batch_run_id: ids1.batchRunId,
          scenario_set_id: ids1.scenarioSetId,
          metadata: { name: "Run With Messages" },
        },
        {
          type: ScenarioEventType.MESSAGE_SNAPSHOT,
          timestamp: timestamp1Message,
          project_id: project.id,
          scenario_id: ids1.scenarioId,
          scenario_run_id: ids1.scenarioRunId,
          batch_run_id: ids1.batchRunId,
          scenario_set_id: ids1.scenarioSetId,
          messages: [{ id: "msg1", role: "user", content: "Hello" }],
        },
        // Run 2: No MESSAGE_SNAPSHOT (failed early)
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: timestamp2Start,
          project_id: project.id,
          scenario_id: ids2.scenarioId,
          scenario_run_id: ids2.scenarioRunId,
          batch_run_id: ids2.batchRunId,
          scenario_set_id: ids2.scenarioSetId,
          metadata: { name: "Run Without Messages" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: timestamp2Start + 100,
          project_id: project.id,
          scenario_id: ids2.scenarioId,
          scenario_run_id: ids2.scenarioRunId,
          batch_run_id: ids2.batchRunId,
          scenario_set_id: ids2.scenarioSetId,
          status: ScenarioRunStatus.ERROR,
          results: { verdict: Verdict.FAILURE },
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      // Call the service method with both scenario run IDs
      const runs = await service.getScenarioRunDataBatch({
        projectId: project.id,
        scenarioRunIds: [ids1.scenarioRunId, ids2.scenarioRunId],
      });

      expect(runs).toHaveLength(2);

      // Find run with messages
      const runWithMessages = runs.find(
        (r) => r.scenarioRunId === ids1.scenarioRunId,
      );
      expect(runWithMessages).toBeDefined();
      expect(runWithMessages!.timestamp).toBe(timestamp1Message);
      expect(runWithMessages!.messages).toHaveLength(1);

      // Find run without messages
      const runWithoutMessages = runs.find(
        (r) => r.scenarioRunId === ids2.scenarioRunId,
      );
      expect(runWithoutMessages).toBeDefined();
      expect(runWithoutMessages!.timestamp).toBe(timestamp2Start);
      expect(runWithoutMessages!.messages).toEqual([]);
    });
  });

  describe("getRunDataForScenarioSet", () => {
    it("should return failed runs without MESSAGE_SNAPSHOT in run history", async () => {
      const client = await esClient({ test: true });
      const ids = generateTestIds("failed-run");
      const runStartedTimestamp = Date.now() - 5000;

      // Simulate a failed scenario run that never produced messages
      const events = [
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: runStartedTimestamp,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          metadata: { name: "Failed Scenario", description: "Early failure" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: runStartedTimestamp + 500,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          status: ScenarioRunStatus.ERROR,
          results: {
            verdict: Verdict.FAILURE,
            reasoning: "Agent connection failed",
          },
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      // Query run data for the scenario set
      const result = await service.getRunDataForScenarioSet({
        projectId: project.id,
        scenarioSetId: ids.scenarioSetId,
        limit: 10,
      });

      expect(result.runs).toHaveLength(1);
      const run = result.runs[0]!;

      // Verify the failed run is included with correct timestamp
      expect(run.scenarioRunId).toBe(ids.scenarioRunId);
      expect(run.status).toBe(ScenarioRunStatus.ERROR);
      expect(run.timestamp).toBe(runStartedTimestamp);
      expect(run.messages).toEqual([]);
      expect(run.name).toBe("Failed Scenario");
    });

    it("should sort runs by timestamp correctly (including runs without messages)", async () => {
      const client = await esClient({ test: true });
      const scenarioSetId = `set-sort-test-${Date.now()}`;

      // Create 3 runs at different times, middle one has no messages
      const run1 = generateTestIds("sort-1");
      const run2 = generateTestIds("sort-2");
      const run3 = generateTestIds("sort-3");

      const timestamp1 = Date.now() - 30000; // Oldest
      const timestamp2 = Date.now() - 20000; // Middle (no messages)
      const timestamp3 = Date.now() - 10000; // Newest

      const events = [
        // Run 1 (oldest, has messages)
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: timestamp1,
          project_id: project.id,
          scenario_id: run1.scenarioId,
          scenario_run_id: run1.scenarioRunId,
          batch_run_id: run1.batchRunId,
          scenario_set_id: scenarioSetId,
          metadata: { name: "Run 1" },
        },
        {
          type: ScenarioEventType.MESSAGE_SNAPSHOT,
          timestamp: timestamp1 + 100,
          project_id: project.id,
          scenario_id: run1.scenarioId,
          scenario_run_id: run1.scenarioRunId,
          batch_run_id: run1.batchRunId,
          scenario_set_id: scenarioSetId,
          messages: [{ id: "msg", role: "user", content: "test" }],
        },

        // Run 2 (middle, NO messages - failed early)
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: timestamp2,
          project_id: project.id,
          scenario_id: run2.scenarioId,
          scenario_run_id: run2.scenarioRunId,
          batch_run_id: run2.batchRunId,
          scenario_set_id: scenarioSetId,
          metadata: { name: "Run 2 - Failed" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: timestamp2 + 100,
          project_id: project.id,
          scenario_id: run2.scenarioId,
          scenario_run_id: run2.scenarioRunId,
          batch_run_id: run2.batchRunId,
          scenario_set_id: scenarioSetId,
          status: ScenarioRunStatus.ERROR,
          results: { verdict: Verdict.FAILURE },
        },

        // Run 3 (newest, has messages)
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: timestamp3,
          project_id: project.id,
          scenario_id: run3.scenarioId,
          scenario_run_id: run3.scenarioRunId,
          batch_run_id: run3.batchRunId,
          scenario_set_id: scenarioSetId,
          metadata: { name: "Run 3" },
        },
        {
          type: ScenarioEventType.MESSAGE_SNAPSHOT,
          timestamp: timestamp3 + 100,
          project_id: project.id,
          scenario_id: run3.scenarioId,
          scenario_run_id: run3.scenarioRunId,
          batch_run_id: run3.batchRunId,
          scenario_set_id: scenarioSetId,
          messages: [{ id: "msg", role: "user", content: "test" }],
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      const result = await service.getRunDataForScenarioSet({
        projectId: project.id,
        scenarioSetId,
        limit: 10,
      });

      expect(result.runs).toHaveLength(3);

      // All three runs should be present and have proper timestamps for sorting
      const _runTimestamps = result.runs.map((r) => ({
        name: r.name,
        timestamp: r.timestamp,
      }));

      // Verify Run 2 (no messages) has timestamp from RUN_STARTED, not 0
      const run2Data = result.runs.find(
        (r) => r.scenarioRunId === run2.scenarioRunId,
      );
      expect(run2Data).toBeDefined();
      expect(run2Data!.timestamp).toBe(timestamp2);
      expect(run2Data!.timestamp).not.toBe(0);
    });
  });

  describe("getRunDataForAllSuites", () => {
    it("returns runs from multiple suites with scenarioSetIds map", async () => {
      const client = await esClient({ test: true });

      // Two different suites with the __internal__<suiteId>__suite pattern
      const suite1SetId = `__internal__suite_aaa_${Date.now()}__suite`;
      const suite2SetId = `__internal__suite_bbb_${Date.now()}__suite`;
      const ids1 = generateTestIds("allsuites-1");
      const ids2 = generateTestIds("allsuites-2");

      const timestamp1 = Date.now() - 10000;
      const timestamp2 = Date.now() - 5000;

      const events = [
        // Suite 1 run
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: timestamp1,
          project_id: project.id,
          scenario_id: ids1.scenarioId,
          scenario_run_id: ids1.scenarioRunId,
          batch_run_id: ids1.batchRunId,
          scenario_set_id: suite1SetId,
          metadata: { name: "Suite 1 Scenario" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: timestamp1 + 500,
          project_id: project.id,
          scenario_id: ids1.scenarioId,
          scenario_run_id: ids1.scenarioRunId,
          batch_run_id: ids1.batchRunId,
          scenario_set_id: suite1SetId,
          status: ScenarioRunStatus.SUCCESS,
          results: { verdict: Verdict.SUCCESS },
        },
        // Suite 2 run
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: timestamp2,
          project_id: project.id,
          scenario_id: ids2.scenarioId,
          scenario_run_id: ids2.scenarioRunId,
          batch_run_id: ids2.batchRunId,
          scenario_set_id: suite2SetId,
          metadata: { name: "Suite 2 Scenario" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: timestamp2 + 500,
          project_id: project.id,
          scenario_id: ids2.scenarioId,
          scenario_run_id: ids2.scenarioRunId,
          batch_run_id: ids2.batchRunId,
          scenario_set_id: suite2SetId,
          status: ScenarioRunStatus.ERROR,
          results: { verdict: Verdict.FAILURE },
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      const result = await service.getRunDataForAllSuites({
        projectId: project.id,
        limit: 10,
      });

      // Both batch runs should be returned
      expect(result.runs.length).toBeGreaterThanOrEqual(2);

      // scenarioSetIds map should contain both batch run → set id mappings
      expect(result.scenarioSetIds[ids1.batchRunId]).toBe(suite1SetId);
      expect(result.scenarioSetIds[ids2.batchRunId]).toBe(suite2SetId);

      // Verify runs from both suites are present
      const run1 = result.runs.find((r) => r.batchRunId === ids1.batchRunId);
      const run2 = result.runs.find((r) => r.batchRunId === ids2.batchRunId);
      expect(run1).toBeDefined();
      expect(run2).toBeDefined();
      expect(run1!.status).toBe(ScenarioRunStatus.SUCCESS);
      expect(run2!.status).toBe(ScenarioRunStatus.ERROR);
    });

    it("includes pre-suite runs with scenarioSetId 'default'", async () => {
      const client = await esClient({ test: true });

      const defaultSetId = "default";
      const ids = generateTestIds("allsuites-default");
      const now = Date.now();

      const events = [
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: now - 5000,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: defaultSetId,
          metadata: { name: "Pre-Suite Run" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: now - 4500,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: defaultSetId,
          status: ScenarioRunStatus.SUCCESS,
          results: { verdict: Verdict.SUCCESS },
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      const result = await service.getRunDataForAllSuites({
        projectId: project.id,
        limit: 100,
      });

      const preSuiteRun = result.runs.find((r) => r.batchRunId === ids.batchRunId);
      expect(preSuiteRun).toBeDefined();
      expect(preSuiteRun!.status).toBe(ScenarioRunStatus.SUCCESS);
      expect(result.scenarioSetIds[ids.batchRunId]).toBe(defaultSetId);
    });

    it("includes both suite and non-suite runs together", async () => {
      const client = await esClient({ test: true });

      // Suite run
      const suiteSetId = `__internal__suite_ccc_${Date.now()}__suite`;
      const suiteIds = generateTestIds("allsuites-include");

      // Pre-suite run with "default" scenarioSetId
      const defaultSetId = "default";
      const defaultIds = generateTestIds("allsuites-default-mix");

      const now = Date.now();

      const events = [
        // Suite run
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: now - 5000,
          project_id: project.id,
          scenario_id: suiteIds.scenarioId,
          scenario_run_id: suiteIds.scenarioRunId,
          batch_run_id: suiteIds.batchRunId,
          scenario_set_id: suiteSetId,
          metadata: { name: "Suite Run" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: now - 4500,
          project_id: project.id,
          scenario_id: suiteIds.scenarioId,
          scenario_run_id: suiteIds.scenarioRunId,
          batch_run_id: suiteIds.batchRunId,
          scenario_set_id: suiteSetId,
          status: ScenarioRunStatus.SUCCESS,
          results: { verdict: Verdict.SUCCESS },
        },
        // Pre-suite run
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: now - 3000,
          project_id: project.id,
          scenario_id: defaultIds.scenarioId,
          scenario_run_id: defaultIds.scenarioRunId,
          batch_run_id: defaultIds.batchRunId,
          scenario_set_id: defaultSetId,
          metadata: { name: "Pre-Suite Run" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: now - 2500,
          project_id: project.id,
          scenario_id: defaultIds.scenarioId,
          scenario_run_id: defaultIds.scenarioRunId,
          batch_run_id: defaultIds.batchRunId,
          scenario_set_id: defaultSetId,
          status: ScenarioRunStatus.SUCCESS,
          results: { verdict: Verdict.SUCCESS },
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      const result = await service.getRunDataForAllSuites({
        projectId: project.id,
        limit: 100,
      });

      // Both runs should be present
      const suiteRun = result.runs.find((r) => r.batchRunId === suiteIds.batchRunId);
      const defaultRun = result.runs.find((r) => r.batchRunId === defaultIds.batchRunId);
      expect(suiteRun).toBeDefined();
      expect(defaultRun).toBeDefined();

      // scenarioSetIds should have both
      expect(result.scenarioSetIds[suiteIds.batchRunId]).toBe(suiteSetId);
      expect(result.scenarioSetIds[defaultIds.batchRunId]).toBe(defaultSetId);
    });

    it("returns empty results for a project with no runs", async () => {
      // Use a unique project ID that has no data at all
      const emptyProjectId = `proj_empty_${Date.now()}`;
      const result = await service.getRunDataForAllSuites({
        projectId: emptyProjectId,
        limit: 10,
      });

      expect(result.runs).toHaveLength(0);
      expect(result.scenarioSetIds).toEqual({});
      expect(result.hasMore).toBe(false);
    });
  });

  describe("getScenarioRunData (single run)", () => {
    it("should return correct data for a run without MESSAGE_SNAPSHOT", async () => {
      const client = await esClient({ test: true });
      const ids = generateTestIds("single-no-msg");
      const runStartedTimestamp = Date.now() - 5000;

      const events = [
        {
          type: ScenarioEventType.RUN_STARTED,
          timestamp: runStartedTimestamp,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          metadata: { name: "Single Run Test" },
        },
        {
          type: ScenarioEventType.RUN_FINISHED,
          timestamp: runStartedTimestamp + 1000,
          project_id: project.id,
          scenario_id: ids.scenarioId,
          scenario_run_id: ids.scenarioRunId,
          batch_run_id: ids.batchRunId,
          scenario_set_id: ids.scenarioSetId,
          status: ScenarioRunStatus.ERROR,
          results: { verdict: Verdict.FAILURE },
        },
      ];

      await client.bulk({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: events.flatMap((event) => [{ index: {} }, event]),
        refresh: true,
      });

      const run = await service.getScenarioRunData({
        projectId: project.id,
        scenarioRunId: ids.scenarioRunId,
      });

      expect(run).not.toBeNull();
      expect(run!.scenarioRunId).toBe(ids.scenarioRunId);
      expect(run!.status).toBe(ScenarioRunStatus.ERROR);
      // Single run method uses runStartedEvent.timestamp as fallback
      expect(run!.timestamp).toBe(runStartedTimestamp);
      expect(run!.messages).toEqual([]);
    });
  });
});
