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
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClickHouseClientForProjectMock = vi.fn();
vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: (...args: unknown[]) =>
    getClickHouseClientForProjectMock(...args),
}));

import { ExperimentRunService } from "../experiment-run.service";

function makeService() {
  return new ExperimentRunService({} as any);
}

describe("ExperimentRunService.getRun", () => {
  beforeEach(() => {
    getClickHouseClientForProjectMock.mockReset();
  });

  describe("when the ClickHouse client is unavailable", () => {
    it("returns null instead of throwing so the UI can poll without 500-cascade", async () => {
      getClickHouseClientForProjectMock.mockResolvedValue(null);

      const result = await makeService().getRun({
        projectId: "project_x",
        experimentId: "experiment_y",
        runId: "run_z",
      });

      expect(result).toBeNull();
    });
  });

  describe("when the run row has not been folded into ClickHouse yet", () => {
    it("returns null so the UI can poll until the projection lands", async () => {
      getClickHouseClientForProjectMock.mockResolvedValue({
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await makeService().getRun({
        projectId: "project_x",
        experimentId: "experiment_y",
        runId: "run_z",
      });

      expect(result).toBeNull();
    });
  });
});
