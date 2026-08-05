/**
 * @vitest-environment node
 *
 * Dispatch and report, end to end over a real database.
 *
 * The join between a variant and its verdict is the run id the variant was
 * dispatched under. Nothing here pre-sets that id: it exists only if dispatch
 * actually wrote it, which is the whole point of running these two services
 * against each other rather than against fixtures.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";
import { FanOutRepository } from "~/server/scenarios/fan-out/fan-out.repository";
import { getFanOutSetId } from "~/server/scenarios/fanout-set-id";
import { ScenarioRepository } from "~/server/scenarios/scenario.repository";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { getTestProject } from "~/utils/testUtils";
import { FanOutReportService } from "../fan-out-report.service";
import { FanOutRunService } from "../fan-out-run.service";

let projectId: string;

const batchId = "fanoutbatch_dispatch_report";

/**
 * Stands in for ClickHouse: answers with a run per scenarioRunId that dispatch
 * actually queued, so the report has something real to join against without a
 * verdict store in the loop.
 */
function fakeSimulationRuns(queued: Array<{ scenarioRunId: string }>) {
  return {
    getRunDataForBatchRun: vi.fn().mockResolvedValue({
      changed: true,
      lastUpdatedAt: 1,
      runs: queued.map(({ scenarioRunId }, index) => ({
        scenarioId: `scenario_${index}`,
        batchRunId: "batchrun_1",
        scenarioRunId,
        status:
          index === 0 ? ScenarioRunStatus.FAILED : ScenarioRunStatus.SUCCESS,
        messages: [],
        timestamp: 0,
        durationInMs: 0,
      })),
    }),
  };
}

async function seedApprovedBatch() {
  const scenarios = await Promise.all(
    [0, 1, 2].map((index) =>
      prisma.scenario.create({
        data: {
          id: `${batchId}_scenario_${index}`,
          projectId,
          name: `Variant ${index}`,
          situation: `Situation ${index}`,
          criteria: [`Criterion ${index}`],
          labels: ["fan-out"],
        },
      }),
    ),
  );

  await prisma.fanOutBatch.create({
    data: {
      id: batchId,
      projectId,
      seedType: "FREE_TEXT",
      seedDescription: "Agent refuses refunds over $500",
      seedCriteria: ["Processes eligible refunds"],
      seedTarget: { type: "prompt", referenceId: "prompt_abc" },
      scenarioSetId: getFanOutSetId(batchId),
      status: "READY_FOR_REVIEW",
    },
  });

  await Promise.all(
    scenarios.map((scenario, index) =>
      prisma.fanOutVariant.create({
        data: {
          id: `${batchId}_variant_${index}`,
          batchId,
          scenarioId: scenario.id,
          lens: index === 0 ? "paraphrase" : "boundary_value",
          rationale: `Why variant ${index} matters`,
          status: "APPROVED",
          // Deliberately left null. A report that only works because the
          // fixture filled this in proves nothing about dispatch.
          scenarioRunId: null,
        },
      }),
    ),
  );
}

describe("fan-out dispatch and report", () => {
  beforeAll(async () => {
    projectId = (await getTestProject("fan-out-dispatch")).id;
  });

  beforeEach(async () => {
    await prisma.fanOutVariant.deleteMany({ where: { batch: { projectId } } });
    await prisma.fanOutBatch.deleteMany({ where: { projectId } });
    await prisma.scenario.deleteMany({ where: { projectId } });
    await seedApprovedBatch();
  });

  describe("given an approved batch is dispatched", () => {
    /** @scenario "Each dispatched variant records the run it was dispatched under" */
    it("records every variant's run id", async () => {
      const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
      const runService = FanOutRunService.create({
        queueSimulationRun,
        fanOutRepository: new FanOutRepository(prisma),
        scenarioRepository: new ScenarioRepository(prisma),
      });

      await runService.dispatchBatch({ projectId, batchId });

      const variants = await prisma.fanOutVariant.findMany({
        where: { batchId },
      });
      expect(variants).toHaveLength(3);
      expect(variants.every((variant) => !!variant.scenarioRunId)).toBe(true);

      const queuedIds = new Set(
        queueSimulationRun.mock.calls.map(([data]) => data.scenarioRunId),
      );
      for (const variant of variants) {
        expect(queuedIds.has(variant.scenarioRunId!)).toBe(true);
      }
    });

    /** @scenario "View the blast radius once all runs finish" */
    it("reports a blast radius for the runs it dispatched", async () => {
      const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
      const fanOutRepository = new FanOutRepository(prisma);
      const runService = FanOutRunService.create({
        queueSimulationRun,
        fanOutRepository,
        scenarioRepository: new ScenarioRepository(prisma),
      });

      await runService.dispatchBatch({ projectId, batchId });

      const queued = queueSimulationRun.mock.calls.map(([data]) => ({
        scenarioRunId: data.scenarioRunId as string,
      }));
      const reportService = FanOutReportService.create({
        simulationRuns: fakeSimulationRuns(queued) as never,
        fanOutRepository,
      });

      const report = await reportService.getReportForBatch({
        projectId,
        batchId,
      });

      // Every variant resolved to a run, which only holds because dispatch
      // persisted the ids it generated.
      expect(report.totalVariants).toBe(3);
      expect(report.finishedVariants).toBe(3);
      expect(report.variants.every((entry) => entry.run !== null)).toBe(true);
      expect(report.blastRadius).not.toBeNull();
    });
  });
});
