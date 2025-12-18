import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { esClient, SCENARIO_EVENTS_INDEX } from "~/server/elasticsearch";
import { ScenarioEventService } from "../[[...route]]/scenario-event.service";
import { ScenarioEventType, ScenarioRunStatus } from "../[[...route]]/enums";

/**
 * Integration tests for ScenarioEventService.
 *
 * These tests verify the service layer works correctly with Elasticsearch.
 * They cover:
 * - Filter scenarios returns matching records
 * - Sort scenarios returns ordered results
 * - Paginate scenarios returns correct page
 * - Combined filter + sort + pagination
 * - Empty filter results
 * - Repository edge cases (IN_PROGRESS status, cross-index search)
 */
describe("ScenarioEventService Integration", () => {
  let service: ScenarioEventService;
  let testProjectId: string;
  let client: Awaited<ReturnType<typeof esClient>>;

  beforeEach(async () => {
    testProjectId = `test-project-${nanoid()}`;
    service = new ScenarioEventService();
    client = await esClient({ test: true });
  });

  afterEach(async () => {
    // Clean up test data
    await client.deleteByQuery({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          term: { project_id: testProjectId },
        },
      },
      refresh: true,
    });
  });

  // Helper to create scenario events
  async function createScenarioRun({
    status,
    timestamp,
    name,
    scenarioId,
    scenarioRunId,
    scenarioSetId,
    batchRunId,
    includeFinishedEvent = true,
  }: {
    status?: ScenarioRunStatus;
    timestamp?: number;
    name?: string;
    scenarioId?: string;
    scenarioRunId?: string;
    scenarioSetId?: string;
    batchRunId?: string;
    includeFinishedEvent?: boolean;
  }) {
    const runId = scenarioRunId ?? `run-${nanoid()}`;
    const scnId = scenarioId ?? `scenario-${nanoid()}`;
    const setId = scenarioSetId ?? `set-${nanoid()}`;
    const batchId = batchRunId ?? `batch-${nanoid()}`;
    const ts = timestamp ?? Date.now();

    // Create RUN_STARTED event
    await client.index({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        type: ScenarioEventType.RUN_STARTED,
        project_id: testProjectId,
        scenario_id: scnId,
        scenario_run_id: runId,
        scenario_set_id: setId,
        batch_run_id: batchId,
        timestamp: ts,
        metadata: {
          name: name ?? `Test Scenario ${runId}`,
        },
      },
      refresh: true,
    });

    // Create RUN_FINISHED event if status provided
    if (includeFinishedEvent && status) {
      await client.index({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: {
          type: ScenarioEventType.RUN_FINISHED,
          project_id: testProjectId,
          scenario_id: scnId,
          scenario_run_id: runId,
          scenario_set_id: setId,
          batch_run_id: batchId,
          timestamp: ts + 1000,
          status,
          results: {
            verdict: status === ScenarioRunStatus.SUCCESS ? "SUCCESS" : "FAILED",
          },
        },
        refresh: true,
      });
    }

    return { scenarioRunId: runId, scenarioId: scnId, scenarioSetId: setId, batchRunId: batchId };
  }

  // ===========================================================================
  // Service Layer Tests
  // ===========================================================================

  describe("getFilteredScenarioRuns", () => {
    describe("Filter scenarios returns matching records", () => {
      it("returns only scenarios with matching status", async () => {
        // Given: scenarios exist with statuses PASSED, FAILED, ERROR
        await createScenarioRun({ status: ScenarioRunStatus.SUCCESS });
        await createScenarioRun({ status: ScenarioRunStatus.FAILED });
        await createScenarioRun({ status: ScenarioRunStatus.ERROR });

        // When: filter by FAILED status
        const result = await service.getFilteredScenarioRuns({
          projectId: testProjectId,
          filters: [{ columnId: "status", operator: "eq", value: "FAILED" }],
        });

        // Then: only FAILED scenarios returned
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.status).toBe(ScenarioRunStatus.FAILED);
      });
    });

    describe("Sort scenarios returns ordered results", () => {
      it("returns scenarios sorted by timestamp descending", async () => {
        // Given: scenarios with timestamps 10am, 11am, 12pm
        const baseTime = Date.now();
        const { scenarioRunId: run1 } = await createScenarioRun({
          status: ScenarioRunStatus.SUCCESS,
          timestamp: baseTime,
          name: "Run 10am",
        });
        const { scenarioRunId: run2 } = await createScenarioRun({
          status: ScenarioRunStatus.SUCCESS,
          timestamp: baseTime + 3600000,
          name: "Run 11am",
        });
        const { scenarioRunId: run3 } = await createScenarioRun({
          status: ScenarioRunStatus.SUCCESS,
          timestamp: baseTime + 7200000,
          name: "Run 12pm",
        });

        // When: sort by timestamp descending
        const result = await service.getFilteredScenarioRuns({
          projectId: testProjectId,
          sorting: { columnId: "timestamp", order: "desc" },
        });

        // Then: returned in order 12pm, 11am, 10am
        expect(result.rows).toHaveLength(3);
        expect(result.rows[0]?.scenarioRunId).toBe(run3);
        expect(result.rows[1]?.scenarioRunId).toBe(run2);
        expect(result.rows[2]?.scenarioRunId).toBe(run1);
      });
    });

    describe("Paginate scenarios returns correct page", () => {
      it("returns the correct page of results", async () => {
        // Given: 50 scenarios exist
        const createdRuns: string[] = [];
        for (let i = 0; i < 50; i++) {
          const { scenarioRunId } = await createScenarioRun({
            status: ScenarioRunStatus.SUCCESS,
            timestamp: Date.now() - i * 1000, // Descending order
          });
          createdRuns.push(scenarioRunId);
        }

        // When: request page 2 with pageSize 20
        const result = await service.getFilteredScenarioRuns({
          projectId: testProjectId,
          pagination: { page: 2, pageSize: 20 },
          sorting: { columnId: "timestamp", order: "desc" },
        });

        // Then: scenarios 21-40 are returned
        expect(result.rows).toHaveLength(20);
        expect(result.totalCount).toBe(50);
      });
    });

    describe("Empty filter results returns empty array", () => {
      it("returns empty array with total count 0", async () => {
        // Given: scenarios exist but none match filter
        await createScenarioRun({ status: ScenarioRunStatus.SUCCESS });

        // When: filter by non-existent status
        const result = await service.getFilteredScenarioRuns({
          projectId: testProjectId,
          filters: [{ columnId: "status", operator: "eq", value: "NONEXISTENT" }],
        });

        // Then: empty array with count 0
        expect(result.rows).toHaveLength(0);
        expect(result.totalCount).toBe(0);
      });
    });

    describe("Combined filter, sort, and pagination work together", () => {
      it("filters, sorts, and paginates correctly", async () => {
        // Given: 30 scenarios with mixed statuses and timestamps
        const baseTime = Date.now();
        for (let i = 0; i < 15; i++) {
          await createScenarioRun({
            status: ScenarioRunStatus.FAILED,
            timestamp: baseTime - i * 1000,
          });
        }
        for (let i = 0; i < 15; i++) {
          await createScenarioRun({
            status: ScenarioRunStatus.SUCCESS,
            timestamp: baseTime - i * 1000,
          });
        }

        // When: filter by FAILED, sort by timestamp desc, page 1, pageSize 10
        const result = await service.getFilteredScenarioRuns({
          projectId: testProjectId,
          filters: [{ columnId: "status", operator: "eq", value: "FAILED" }],
          sorting: { columnId: "timestamp", order: "desc" },
          pagination: { page: 1, pageSize: 10 },
        });

        // Then: only FAILED, sorted, max 10 results
        expect(result.rows.length).toBeLessThanOrEqual(10);
        expect(result.totalCount).toBe(15);
        result.rows.forEach((row) => {
          expect(row.status).toBe(ScenarioRunStatus.FAILED);
        });

        // Verify sorting
        for (let i = 1; i < result.rows.length; i++) {
          const prevTimestamp = result.rows[i - 1]?.timestamp ?? 0;
          const currTimestamp = result.rows[i]?.timestamp ?? 0;
          expect(prevTimestamp).toBeGreaterThanOrEqual(currTimestamp);
        }
      });
    });
  });

  // ===========================================================================
  // Repository Edge Cases
  // ===========================================================================

  describe("Repository edge cases", () => {
    describe("Filter by IN_PROGRESS status finds runs without finished event", () => {
      it("returns only unfinished runs", async () => {
        // Given: one run started but not finished, one finished
        const { scenarioRunId: inProgressRun } = await createScenarioRun({
          includeFinishedEvent: false, // No RUN_FINISHED event
        });
        await createScenarioRun({
          status: ScenarioRunStatus.SUCCESS,
          includeFinishedEvent: true,
        });

        // When: filter by IN_PROGRESS status
        const result = await service.getFilteredScenarioRuns({
          projectId: testProjectId,
          filters: [{ columnId: "status", operator: "eq", value: "IN_PROGRESS" }],
        });

        // Then: only the unfinished run is returned
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.scenarioRunId).toBe(inProgressRun);
        expect(result.rows[0]?.status).toBe(ScenarioRunStatus.IN_PROGRESS);
      });
    });

    describe("Filter by finished status queries RUN_FINISHED events directly", () => {
      it("returns only SUCCESS runs", async () => {
        // Given: scenarios with SUCCESS, FAILED, ERROR statuses
        const { scenarioRunId: successRun } = await createScenarioRun({
          status: ScenarioRunStatus.SUCCESS,
        });
        await createScenarioRun({ status: ScenarioRunStatus.FAILED });
        await createScenarioRun({ status: ScenarioRunStatus.ERROR });

        // When: filter by SUCCESS status
        const result = await service.getFilteredScenarioRuns({
          projectId: testProjectId,
          filters: [{ columnId: "status", operator: "eq", value: "SUCCESS" }],
        });

        // Then: only SUCCESS runs returned
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.scenarioRunId).toBe(successRun);
        expect(result.rows[0]?.status).toBe(ScenarioRunStatus.SUCCESS);
      });
    });

    describe("Search scenarios by text", () => {
      it("returns scenarios matching search term in name", async () => {
        // Given: scenarios with different names
        const { scenarioRunId: loginRun } = await createScenarioRun({
          status: ScenarioRunStatus.SUCCESS,
          name: "Login flow test",
        });
        await createScenarioRun({
          status: ScenarioRunStatus.SUCCESS,
          name: "Checkout flow test",
        });

        // When: search for "login"
        const result = await service.getFilteredScenarioRuns({
          projectId: testProjectId,
          search: "login",
        });

        // Then: only login scenario returned
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.scenarioRunId).toBe(loginRun);
      });
    });
  });
});
