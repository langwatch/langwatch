/**
 * @vitest-environment node
 *
 * Unit tests for FanOutRunService dispatch.
 *
 * Covers @integration scenarios from adjacent-scenario-blast-radius.feature:
 * - Running a batch queues all approved variants under one shared batch run
 * - The seed itself runs alongside the variants as a baseline
 */
import type { FanOutVariant } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
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

describe("FanOutRunService", () => {
  describe("given a batch with approved variants", () => {
    describe("when the run is started", () => {
      it("queues every approved variant under one shared batch run", async () => {
        const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
        const service = FanOutRunService.create({ queueSimulationRun });

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
        const service = FanOutRunService.create({ queueSimulationRun });

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

      it("dispatches every run against the batch's target", async () => {
        const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
        const service = FanOutRunService.create({ queueSimulationRun });

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
    });
  });

  describe("given the seed is a real scenario", () => {
    it("runs the seed alongside the variants as a baseline", async () => {
      const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
      const service = FanOutRunService.create({ queueSimulationRun });

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

  describe("given the seed was never a scenario (a trace or pasted incident)", () => {
    it("queues only the variants", async () => {
      const queueSimulationRun = vi.fn().mockResolvedValue(undefined);
      const service = FanOutRunService.create({ queueSimulationRun });

      const result = await service.startRun({
        ...baseParams,
        seedScenarioId: null,
        approvedVariants: [variant({ id: "v1", scenarioId: "scenario_1" })],
      });

      expect(result.itemCount).toBe(1);
      expect(queueSimulationRun).toHaveBeenCalledTimes(1);
    });
  });
});
