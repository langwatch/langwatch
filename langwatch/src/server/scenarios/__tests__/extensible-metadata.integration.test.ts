/**
 * @vitest-environment node
 *
 * Integration tests for extensible metadata on scenario run events.
 * Tests full round-trip: ingest -> store -> retrieve with metadata preserved.
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

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

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
  } catch {
    // ignore cleanup failures
  }
}

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

describe("extensible metadata integration", () => {
  let project: Project;
  let service: ScenarioEventService;

  beforeAll(async () => {
    project = await getTestProject(
      `extensible-metadata-test-${Date.now()}`
    );
    service = new ScenarioEventService();
  });

  afterAll(async () => {
    await cleanupScenarioEvents([project.id]);
    await prisma.project.delete({ where: { id: project.id } });
  });

  beforeEach(async () => {
    await cleanupScenarioEvents([project.id]);
  });

  describe("given a SCENARIO_RUN_STARTED event with custom metadata", () => {
    describe("when the event is ingested and retrieved", () => {
      it("preserves custom metadata fields in run data", async () => {
        const client = await esClient({ test: true });
        const ids = generateTestIds("custom-meta");
        const now = Date.now();

        const events = [
          {
            type: ScenarioEventType.RUN_STARTED,
            timestamp: now - 5000,
            project_id: project.id,
            scenario_id: ids.scenarioId,
            scenario_run_id: ids.scenarioRunId,
            batch_run_id: ids.batchRunId,
            scenario_set_id: ids.scenarioSetId,
            metadata: {
              name: "Login flow",
              description: "Tests login",
              environment: "staging",
              commit_sha: "abc123",
            },
          },
          {
            type: ScenarioEventType.RUN_FINISHED,
            timestamp: now,
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

        const runs = await service.getScenarioRunDataBatch({
          projectId: project.id,
          scenarioRunIds: [ids.scenarioRunId],
        });

        expect(runs).toHaveLength(1);
        const run = runs[0]!;
        expect(run.name).toBe("Login flow");
        expect(run.description).toBe("Tests login");
        expect(run.metadata).toBeDefined();
        expect(run.metadata!.name).toBe("Login flow");
        expect(run.metadata!.description).toBe("Tests login");
        expect(
          (run.metadata as Record<string, unknown>).environment
        ).toBe("staging");
        expect(
          (run.metadata as Record<string, unknown>).commit_sha
        ).toBe("abc123");
      });
    });
  });

  describe("given a SCENARIO_RUN_STARTED event with only name and description", () => {
    describe("when the event is ingested and retrieved", () => {
      it("preserves the standard metadata fields", async () => {
        const client = await esClient({ test: true });
        const ids = generateTestIds("standard-meta");
        const now = Date.now();

        const events = [
          {
            type: ScenarioEventType.RUN_STARTED,
            timestamp: now - 5000,
            project_id: project.id,
            scenario_id: ids.scenarioId,
            scenario_run_id: ids.scenarioRunId,
            batch_run_id: ids.batchRunId,
            scenario_set_id: ids.scenarioSetId,
            metadata: {
              name: "Login flow",
              description: "Tests login",
            },
          },
          {
            type: ScenarioEventType.RUN_FINISHED,
            timestamp: now,
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

        const runs = await service.getScenarioRunDataBatch({
          projectId: project.id,
          scenarioRunIds: [ids.scenarioRunId],
        });

        expect(runs).toHaveLength(1);
        const run = runs[0]!;
        expect(run.metadata).toBeDefined();
        expect(run.metadata!.name).toBe("Login flow");
        expect(run.metadata!.description).toBe("Tests login");
      });
    });
  });

  describe("given a SCENARIO_RUN_STARTED event with langwatch namespace metadata", () => {
    describe("when the event is ingested and retrieved", () => {
      it("preserves the langwatch namespace in metadata", async () => {
        const client = await esClient({ test: true });
        const ids = generateTestIds("langwatch-meta");
        const now = Date.now();

        const events = [
          {
            type: ScenarioEventType.RUN_STARTED,
            timestamp: now - 5000,
            project_id: project.id,
            scenario_id: ids.scenarioId,
            scenario_run_id: ids.scenarioRunId,
            batch_run_id: ids.batchRunId,
            scenario_set_id: ids.scenarioSetId,
            metadata: {
              name: "Login flow",
              langwatch: {
                targetReferenceId: "prompt_abc123",
                targetType: "prompt",
              },
            },
          },
          {
            type: ScenarioEventType.RUN_FINISHED,
            timestamp: now,
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

        const runs = await service.getScenarioRunDataBatch({
          projectId: project.id,
          scenarioRunIds: [ids.scenarioRunId],
        });

        expect(runs).toHaveLength(1);
        const run = runs[0]!;
        const metadata = run.metadata as Record<string, unknown>;
        expect(metadata.langwatch).toEqual({
          targetReferenceId: "prompt_abc123",
          targetType: "prompt",
        });
      });
    });
  });
});
