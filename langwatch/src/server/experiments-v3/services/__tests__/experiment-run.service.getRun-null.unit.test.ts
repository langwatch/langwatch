/**
 * Pins the eval-v3 "perpetual spinner" UX bug caught during PR #3483
 * dogfood: when a freshly-started eval-v3 run hadn't yet been folded
 * into ClickHouse `experiment_runs`, `getRun` threw a 500 with
 * "ClickHouse is enabled but returned null for getRun — check
 * ClickHouse client configuration". The UI's 1s polling loop then
 * cascaded the error toast every tick AND stayed in skeleton state
 * forever; user couldn't tell whether the run was running, broken, or
 * finished with no results.
 *
 * Root cause is timing: `runOrchestrator → commands.startExperimentRun`
 * dispatches an event-sourcing command that the
 * `experiment-run-processing` pipeline (in workers) folds into
 * `experiment_runs`. There's a window between the orchestrator
 * returning and the row landing in CH. Wrapping that window in a 500
 * confused UX and hid the (more severe) downstream pipeline-stuck
 * cases behind the same error string.
 *
 * Fix: return `null` instead of throwing. The two consumers
 * (`BatchEvaluationV2EvaluationResults` + `useMultiRunData`) already
 * optional-chain on the data, so null surfaces as a clean "loading"
 * state. The UI's poll picks the row up the moment it materialises.
 */
import { describe, expect, it, vi } from "vitest";
import { ExperimentRunService } from "../experiment-run.service";

describe("ExperimentRunService.getRun", () => {
  describe("when ClickHouse returns null for the run row", () => {
    it("returns null instead of throwing so the UI can poll without 500-cascade", async () => {
      const service = new ExperimentRunService({} as any);
      // Replace the ClickHouse facade with one that simulates the
      // "not folded yet" window.
      (service as any).clickHouseService = {
        getRun: vi.fn().mockResolvedValue(null),
      };

      const result = await service.getRun({
        projectId: "project_x",
        experimentId: "experiment_y",
        runId: "run_z",
      });

      expect(result).toBeNull();
    });
  });

  describe("when ClickHouse returns a populated run row", () => {
    it("forwards the row through unchanged", async () => {
      const populatedRun = {
        experimentId: "experiment_y",
        runId: "run_z",
        projectId: "project_x",
        dataset: [],
        evaluations: [],
        timestamps: { createdAt: 1, updatedAt: 2 },
      };
      const service = new ExperimentRunService({} as any);
      (service as any).clickHouseService = {
        getRun: vi.fn().mockResolvedValue(populatedRun),
      };

      const result = await service.getRun({
        projectId: "project_x",
        experimentId: "experiment_y",
        runId: "run_z",
      });

      expect(result).toEqual(populatedRun);
    });
  });
});
