/**
 * The run-scoped half: the DELETE family archives exactly one run when the
 * caller names it, and answers not-found for a run the project does not hold.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { SimulationService } from "@langwatch/scenario-contract";

// Partial: a whole-module replacement of the observability package takes away
// exports the transport reads at module scope, and the file then fails to
// collect before a single case runs. Only the logger is stubbed.
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/observability")>()),
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { archiveScenarioRun } from "../scenario-event.api.ts";

describe("archiveScenarioRun()", () => {
  let mockTryGetScenarioRunData: Mock;
  let mockDeleteRun: Mock;
  let simulations: Pick<SimulationService, "tryGetScenarioRunData" | "deleteRun">;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTryGetScenarioRunData = vi.fn().mockResolvedValue(null);
    mockDeleteRun = vi.fn().mockResolvedValue(undefined);
    simulations = {
      tryGetScenarioRunData: mockTryGetScenarioRunData,
      deleteRun: mockDeleteRun,
    } as unknown as Pick<SimulationService, "tryGetScenarioRunData" | "deleteRun">;
  });

  describe("when the run belongs to the project", () => {
    /** @scenario "DELETE with scenarioRunId archives exactly that run" */
    it("dispatches deleteRun for that run only and reports it", async () => {
      mockTryGetScenarioRunData.mockResolvedValue({ scenarioRunId: "run-1" });

      const result = await archiveScenarioRun({
        simulations,
        projectId: "project-a",
        scenarioRunId: "run-1",
      });

      expect(result).toEqual({ archived: 1, failed: 0, scenarioRunId: "run-1" });
      expect(mockTryGetScenarioRunData).toHaveBeenCalledWith({
        projectId: "project-a",
        scenarioRunId: "run-1",
      });
      expect(mockDeleteRun).toHaveBeenCalledTimes(1);
      expect(mockDeleteRun).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project-a", scenarioRunId: "run-1" }),
      );
    });
  });

  describe("when the project does not hold the run", () => {
    /** @scenario "DELETE with a scenarioRunId the project does not hold is not found" */
    it("answers null and archives nothing", async () => {
      mockTryGetScenarioRunData.mockResolvedValue(null);

      const result = await archiveScenarioRun({
        simulations,
        projectId: "project-a",
        scenarioRunId: "run-of-project-b",
      });

      expect(result).toBeNull();
      expect(mockDeleteRun).not.toHaveBeenCalled();
    });
  });
});
