/**
 * @vitest-environment node
 *
 * Unit tests for FanOutReportService's blast-radius aggregation.
 */
import type { FanOutVariant } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { FanOutReportService } from "../fan-out-report.service";

function variant(overrides: Partial<FanOutVariant>): FanOutVariant {
  return {
    id: "variant_1",
    batchId: "batch_1",
    scenarioId: "scenario_1",
    lens: "paraphrase",
    rationale: null,
    status: "APPROVED",
    scenarioRunId: "run_1",
    decidedById: null,
    decidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FanOutVariant;
}

function run({
  scenarioRunId,
  status,
}: {
  scenarioRunId: string;
  status: ScenarioRunStatus;
}) {
  return {
    scenarioId: "scenario_1",
    batchRunId: "batchrun_1",
    scenarioRunId,
    status,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
  };
}

function serviceReturning(
  runs: ReturnType<typeof run>[],
  batch: unknown = null,
) {
  const simulationRuns = {
    getRunDataForBatchRun: vi
      .fn()
      .mockResolvedValue({ changed: true, lastUpdatedAt: 1, runs }),
  };
  const fanOutRepository = {
    findBatchById: vi.fn().mockResolvedValue(batch),
  };
  return FanOutReportService.create({
    simulationRuns: simulationRuns as never,
    fanOutRepository: fanOutRepository as never,
  });
}

const baseParams = {
  projectId: "project_1",
  scenarioSetId: "__internal__batch_1__fanout",
  batchRunId: "batchrun_1",
  seedScenarioRunId: null,
};

describe("FanOutReportService", () => {
  describe("given every variant run has finished", () => {
    describe("when 3 of 7 failed", () => {
      /** @scenario "Blast radius is the ratio of failed to total variants" */
      it("reports a blast radius of 3/7", async () => {
        const variants = Array.from({ length: 7 }, (_, i) =>
          variant({ id: `variant_${i}`, scenarioRunId: `run_${i}` }),
        );
        const runs = variants.map((v, i) =>
          run({
            scenarioRunId: v.scenarioRunId!,
            status:
              i < 3 ? ScenarioRunStatus.FAILED : ScenarioRunStatus.SUCCESS,
          }),
        );

        const report = await serviceReturning(runs).getBlastRadiusReport({
          ...baseParams,
          variants,
        });

        expect(report.totalVariants).toBe(7);
        expect(report.failedVariants).toBe(3);
        expect(report.blastRadius).toBeCloseTo(3 / 7);
      });
    });

    describe("when variants span multiple lenses", () => {
      /** @scenario "Report shows a per-lens breakdown" */
      it("breaks failures down by lens", async () => {
        const variants = [
          variant({ id: "v1", scenarioRunId: "run_1", lens: "paraphrase" }),
          variant({ id: "v2", scenarioRunId: "run_2", lens: "paraphrase" }),
          variant({ id: "v3", scenarioRunId: "run_3", lens: "boundary_value" }),
        ];
        const runs = [
          run({ scenarioRunId: "run_1", status: ScenarioRunStatus.FAILED }),
          run({ scenarioRunId: "run_2", status: ScenarioRunStatus.SUCCESS }),
          run({ scenarioRunId: "run_3", status: ScenarioRunStatus.FAILED }),
        ];

        const report = await serviceReturning(runs).getBlastRadiusReport({
          ...baseParams,
          variants,
        });

        expect(report.byLens.paraphrase).toEqual({
          total: 2,
          finished: 2,
          failed: 1,
        });
        expect(report.byLens.boundary_value).toEqual({
          total: 1,
          finished: 1,
          failed: 1,
        });
      });
    });

    describe("when a run stalled without reaching a verdict", () => {
      it("counts it as a failure, not a pass", async () => {
        const variants = [variant({ id: "v1", scenarioRunId: "run_1" })];
        const runs = [
          run({ scenarioRunId: "run_1", status: ScenarioRunStatus.STALLED }),
        ];

        const report = await serviceReturning(runs).getBlastRadiusReport({
          ...baseParams,
          variants,
        });

        // A wedged run never showed the agent handling the case, so scoring it
        // as a pass would quietly shrink the blast radius.
        expect(report.failedVariants).toBe(1);
        expect(report.blastRadius).toBe(1);
      });
    });

    describe("when a run errored rather than failing its criteria", () => {
      it("counts it as a failure", async () => {
        const variants = [variant({ id: "v1", scenarioRunId: "run_1" })];
        const runs = [
          run({ scenarioRunId: "run_1", status: ScenarioRunStatus.ERROR }),
        ];

        const report = await serviceReturning(runs).getBlastRadiusReport({
          ...baseParams,
          variants,
        });

        expect(report.failedVariants).toBe(1);
      });
    });
  });

  describe("given some variant runs are still in progress", () => {
    /** @scenario "Report updates while runs are still in progress" */
    it("reports a verdict only for the finished ones", async () => {
      const variants = [
        variant({ id: "v1", scenarioRunId: "run_1" }),
        variant({ id: "v2", scenarioRunId: "run_2" }),
      ];
      const runs = [
        run({ scenarioRunId: "run_1", status: ScenarioRunStatus.FAILED }),
        run({ scenarioRunId: "run_2", status: ScenarioRunStatus.IN_PROGRESS }),
      ];

      const report = await serviceReturning(runs).getBlastRadiusReport({
        ...baseParams,
        variants,
      });

      expect(report.finishedVariants).toBe(1);
      expect(report.variants[0]!.failed).toBe(true);
      // Still running: no verdict yet, which is distinct from "passed".
      expect(report.variants[1]!.failed).toBeNull();
    });
  });

  describe("given no variant run has finished yet", () => {
    it("reports no blast radius rather than zero", async () => {
      const variants = [variant({ id: "v1", scenarioRunId: "run_1" })];
      const runs = [
        run({ scenarioRunId: "run_1", status: ScenarioRunStatus.PENDING }),
      ];

      const report = await serviceReturning(runs).getBlastRadiusReport({
        ...baseParams,
        variants,
      });

      // 0/0 would read as "nothing broke", which is a different claim.
      expect(report.blastRadius).toBeNull();
    });
  });

  describe("given the seed itself was run as a baseline", () => {
    /** @scenario "The report shows the seed's own result for comparison" */
    it("surfaces the seed's own result alongside the variants", async () => {
      const variants = [variant({ id: "v1", scenarioRunId: "run_1" })];
      const runs = [
        run({ scenarioRunId: "run_1", status: ScenarioRunStatus.FAILED }),
        run({ scenarioRunId: "seed_run", status: ScenarioRunStatus.FAILED }),
      ];

      const report = await serviceReturning(runs).getBlastRadiusReport({
        ...baseParams,
        seedScenarioRunId: "seed_run",
        variants,
      });

      expect(report.seedRun?.scenarioRunId).toBe("seed_run");
      // The seed is context, never part of the ratio.
      expect(report.totalVariants).toBe(1);
    });
  });

  describe("given a report is asked for by batch id", () => {
    /** @scenario "Reporting on a batch from another project is refused" */
    it("refuses a batch the project cannot see", async () => {
      await expect(
        serviceReturning([], null).getReportForBatch({
          projectId: "project_1",
          batchId: "batch_from_elsewhere",
        }),
      ).rejects.toMatchObject({ code: "fan_out_batch_not_found" });
    });

    /** @scenario "Reporting on a batch that has not run is refused" */
    it("refuses a batch that has not been dispatched", async () => {
      const batch = {
        id: "batch_1",
        scenarioSetId: "__internal__batch_1__fanout",
        batchRunId: null,
        seedScenarioRunId: null,
        variants: [],
      };

      await expect(
        serviceReturning([], batch).getReportForBatch({
          projectId: "project_1",
          batchId: "batch_1",
        }),
      ).rejects.toMatchObject({ code: "fan_out_batch_not_run" });
    });

    it("reports on the batch's own run once it has one", async () => {
      const batch = {
        id: "batch_1",
        scenarioSetId: "__internal__batch_1__fanout",
        batchRunId: "batchrun_1",
        seedScenarioRunId: null,
        variants: [variant({ id: "v1", scenarioRunId: "run_1" })],
      };
      const runs = [
        run({ scenarioRunId: "run_1", status: ScenarioRunStatus.FAILED }),
      ];

      const report = await serviceReturning(runs, batch).getReportForBatch({
        projectId: "project_1",
        batchId: "batch_1",
      });

      expect(report.failedVariants).toBe(1);
    });
  });
});
