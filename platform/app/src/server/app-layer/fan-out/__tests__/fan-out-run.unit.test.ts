/**
 * @vitest-environment node
 *
 * Unit tests for FanOutRunService dispatch.
 */
import type { FanOutVariant } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { FanOutRepository } from "~/server/scenarios/fan-out/fan-out.repository";
import type { ScenarioRepository } from "~/server/scenarios/scenario.repository";
import { FanOutRunService } from "../fan-out-run.service";

function variant(overrides: Partial<FanOutVariant>): FanOutVariant {
  return {
    id: "variant_1",
    batchId: "batch_1",
    scenarioId: "scenario_1",
    lens: "paraphrase",
    rationale: null,
    status: "APPROVED",
    scenarioRunId: null,
    decidedById: null,
    decidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FanOutVariant;
}

const target = { type: "prompt", referenceId: "prompt_abc" } as const;

const baseParams = {
  projectId: "project_1",
  scenarioSetId: "__internal__batch_1__fanout",
  seedName: "Refund flow",
  target,
  variantNames: new Map<string, string>(),
};

function fakeRepositories() {
  const fanOutRepository = {
    setVariantScenarioRunId: vi.fn().mockResolvedValue(undefined),
    findBatchById: vi.fn(),
    updateBatchStatus: vi.fn().mockResolvedValue(undefined),
  };
  const scenarioRepository = { findNamesByIds: vi.fn().mockResolvedValue([]) };
  return { fanOutRepository, scenarioRepository };
}

type QueueMock = ReturnType<typeof vi.fn>;

function makeService(queueSimulationRun: QueueMock) {
  const { fanOutRepository, scenarioRepository } = fakeRepositories();
  return {
    service: FanOutRunService.create({
      queueSimulationRun: queueSimulationRun as never,
      fanOutRepository: fanOutRepository as unknown as FanOutRepository,
      scenarioRepository: scenarioRepository as unknown as ScenarioRepository,
    }),
    fanOutRepository,
    scenarioRepository,
  };
}

describe("FanOutRunService", () => {
  describe("given a batch with approved variants", () => {
    describe("when the run is started", () => {
      /** @scenario "Running a batch queues all approved variants under one shared run" */
      it("queues every approved variant under one shared batch run", async () => {
        const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
        const { service } = makeService(queueSimulationRun);

        const result = await service.startRun({
          ...baseParams,
          seedScenarioId: null,
          approvedVariants: [
            variant({ id: "v1", scenarioId: "scenario_1" }),
            variant({ id: "v2", scenarioId: "scenario_2" }),
            variant({ id: "v3", scenarioId: "scenario_3" }),
          ],
        });

        expect(queueSimulationRun).toHaveBeenCalledTimes(3);
        const batchRunIds = queueSimulationRun.mock.calls.map(
          ([data]) => data.batchRunId,
        );
        expect(new Set(batchRunIds).size).toBe(1);
        expect(batchRunIds[0]).toBe(result.batchRunId);
      });

      it("gives every queued run its own distinct run id", async () => {
        const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
        const { service } = makeService(queueSimulationRun);

        await service.startRun({
          ...baseParams,
          seedScenarioId: null,
          approvedVariants: [
            variant({ id: "v1", scenarioId: "scenario_1" }),
            variant({ id: "v2", scenarioId: "scenario_2" }),
          ],
        });

        const runIds = queueSimulationRun.mock.calls.map(
          ([data]) => data.scenarioRunId,
        );
        expect(new Set(runIds).size).toBe(2);
      });

      /** @scenario "Generated variants inherit the seed's target" */
      it("dispatches every run against the batch's target", async () => {
        const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
        const { service } = makeService(queueSimulationRun);

        await service.startRun({
          ...baseParams,
          seedScenarioId: null,
          approvedVariants: [variant({ id: "v1" })],
        });

        const [data] = queueSimulationRun.mock.calls[0]!;
        expect(data.target).toEqual(target);
        expect(data.metadata.langwatch.targetReferenceId).toBe(
          target.referenceId,
        );
      });

      /** @scenario "A dispatched run records what it ran against" */
      it("records the target type alongside the reference, so the run can seed another fan-out", async () => {
        const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
        const { service } = makeService(queueSimulationRun);

        await service.startRun({
          ...baseParams,
          seedScenarioId: null,
          approvedVariants: [variant({ id: "v1" })],
        });

        const [data] = queueSimulationRun.mock.calls[0]!;
        expect(data.metadata.langwatch.targetType).toBe(target.type);
      });

      /** @scenario "Each dispatched variant records the run it was dispatched under" */
      it("records each variant's run id before queueing it", async () => {
        const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
        const { service, fanOutRepository } = makeService(queueSimulationRun);

        await service.startRun({
          ...baseParams,
          seedScenarioId: "scenario_seed",
          approvedVariants: [
            variant({ id: "v1", scenarioId: "scenario_1" }),
            variant({ id: "v2", scenarioId: "scenario_2" }),
          ],
        });

        expect(fanOutRepository.setVariantScenarioRunId).toHaveBeenCalledTimes(
          2,
        );
        const persisted: Array<{ id: string; scenarioRunId: string }> =
          fanOutRepository.setVariantScenarioRunId.mock.calls.map(
            (call) => call[0],
          );
        expect(persisted.map((entry) => entry.id).sort()).toEqual(["v1", "v2"]);

        // The id written for a variant must be the id its own run was queued
        // under, otherwise the report joins the wrong verdict to it.
        const queuedByScenario = new Map(
          queueSimulationRun.mock.calls.map(([data]) => [
            data.scenarioId,
            data.scenarioRunId,
          ]),
        );
        expect(queuedByScenario.get("scenario_1")).toBe(
          persisted.find((entry) => entry.id === "v1")!.scenarioRunId,
        );
        expect(queuedByScenario.get("scenario_2")).toBe(
          persisted.find((entry) => entry.id === "v2")!.scenarioRunId,
        );
      });

      it("scopes the run id write to the project", async () => {
        const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
        const { service, fanOutRepository } = makeService(queueSimulationRun);

        await service.startRun({
          ...baseParams,
          seedScenarioId: null,
          approvedVariants: [variant({ id: "v1" })],
        });

        expect(fanOutRepository.setVariantScenarioRunId).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: "project_1" }),
        );
      });
    });
  });

  describe("given the seed is a real scenario", () => {
    /** @scenario "The seed itself runs alongside the variants as a baseline" */
    it("runs the seed alongside the variants as a baseline", async () => {
      const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
      const { service } = makeService(queueSimulationRun);

      const result = await service.startRun({
        ...baseParams,
        seedScenarioId: "scenario_seed",
        approvedVariants: [variant({ id: "v1", scenarioId: "scenario_1" })],
      });

      expect(result.itemCount).toBe(2);
      const scenarioIds = queueSimulationRun.mock.calls.map(
        ([data]) => data.scenarioId,
      );
      expect(scenarioIds).toContain("scenario_seed");
      expect(scenarioIds).toContain("scenario_1");
    });
  });

  describe("given the seed was never a scenario (a pasted incident)", () => {
    it("queues only the variants", async () => {
      const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
      const { service } = makeService(queueSimulationRun);

      const result = await service.startRun({
        ...baseParams,
        seedScenarioId: null,
        approvedVariants: [variant({ id: "v1", scenarioId: "scenario_1" })],
      });

      expect(result.itemCount).toBe(1);
      expect(queueSimulationRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a batch is dispatched by id", () => {
    function serviceWithBatch(batch: unknown) {
      const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
      const { fanOutRepository, scenarioRepository } = fakeRepositories();
      fanOutRepository.findBatchById.mockResolvedValue(batch);
      return {
        queueSimulationRun,
        fanOutRepository,
        service: FanOutRunService.create({
          queueSimulationRun,
          fanOutRepository: fanOutRepository as unknown as FanOutRepository,
          scenarioRepository:
            scenarioRepository as unknown as ScenarioRepository,
        }),
      };
    }

    /** @scenario "Rejected variants are excluded from dispatch" */
    it("queues only the approved variants", async () => {
      const { service, queueSimulationRun } = serviceWithBatch({
        id: "batch_1",
        scenarioSetId: "__internal__batch_1__fanout",
        seedScenarioId: null,
        seedTarget: target,
        variants: [
          variant({ id: "v1", scenarioId: "s1", status: "APPROVED" }),
          variant({ id: "v2", scenarioId: "s2", status: "APPROVED" }),
          variant({ id: "v3", scenarioId: "s3", status: "REJECTED" }),
          variant({ id: "v4", scenarioId: "s4", status: "PENDING" }),
        ],
      });

      const result = await service.dispatchBatch({
        projectId: "project_1",
        batchId: "batch_1",
      });

      expect(result.itemCount).toBe(2);
      const scenarioIds = queueSimulationRun.mock.calls.map(
        ([data]) => data.scenarioId,
      );
      expect(scenarioIds.sort()).toEqual(["s1", "s2"]);
    });

    /** @scenario "Running a batch moves it to dispatching" */
    it("moves the batch to dispatching under the run it queued", async () => {
      const { service, fanOutRepository } = serviceWithBatch({
        id: "batch_1",
        scenarioSetId: "__internal__batch_1__fanout",
        seedScenarioId: null,
        seedTarget: target,
        variants: [variant({ id: "v1", scenarioId: "s1", status: "APPROVED" })],
      });

      const result = await service.dispatchBatch({
        projectId: "project_1",
        batchId: "batch_1",
      });

      expect(fanOutRepository.updateBatchStatus).toHaveBeenCalledWith({
        id: "batch_1",
        projectId: "project_1",
        status: "DISPATCHING",
        batchRunId: result.batchRunId,
      });
    });

    it("repoints the batch at the run id the baseline was dispatched under", async () => {
      const { service, fanOutRepository, queueSimulationRun } =
        serviceWithBatch({
          id: "batch_1",
          scenarioSetId: "__internal__batch_1__fanout",
          seedScenarioId: "scenario_seed",
          // The original failure's run id, which is not part of this batch run.
          seedScenarioRunId: "scenariorun_original_failure",
          seedTarget: target,
          variants: [
            variant({ id: "v1", scenarioId: "s1", status: "APPROVED" }),
          ],
        });

      await service.dispatchBatch({
        projectId: "project_1",
        batchId: "batch_1",
      });

      const seedCall = queueSimulationRun.mock.calls.find(
        ([data]) => data.scenarioId === "scenario_seed",
      );
      const written =
        fanOutRepository.updateBatchStatus.mock.calls[0]![0].seedScenarioRunId;

      // Leaving the original id in place would make the report look up a run
      // that is not in this batch, so the baseline comparison never appears.
      expect(written).toBe(seedCall![0].scenarioRunId);
      expect(written).not.toBe("scenariorun_original_failure");
    });

    /** @scenario "Running a batch with nothing approved is refused" */
    it("refuses a batch with nothing approved", async () => {
      const { service, queueSimulationRun } = serviceWithBatch({
        id: "batch_1",
        scenarioSetId: "__internal__batch_1__fanout",
        seedScenarioId: null,
        seedTarget: target,
        variants: [variant({ id: "v1", status: "PENDING" })],
      });

      await expect(
        service.dispatchBatch({ projectId: "project_1", batchId: "batch_1" }),
      ).rejects.toMatchObject({ code: "fan_out_no_approved_variants" });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });

    /** @scenario "Running a batch from another project is refused" */
    it("refuses a batch the project cannot see", async () => {
      const { service, queueSimulationRun } = serviceWithBatch(null);

      await expect(
        service.dispatchBatch({
          projectId: "project_1",
          batchId: "batch_from_elsewhere",
        }),
      ).rejects.toMatchObject({ code: "fan_out_batch_not_found" });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });

    it("refuses a batch whose stored target is not usable", async () => {
      const { service, queueSimulationRun } = serviceWithBatch({
        id: "batch_1",
        scenarioSetId: "__internal__batch_1__fanout",
        seedScenarioId: null,
        seedTarget: { referenceId: "prompt_abc" },
        variants: [variant({ id: "v1", status: "APPROVED" })],
      });

      await expect(
        service.dispatchBatch({ projectId: "project_1", batchId: "batch_1" }),
      ).rejects.toMatchObject({ code: "fan_out_batch_target_invalid" });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });
});
