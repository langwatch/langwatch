/** Spec: specs/suites/test-suites.feature */
import { describe, expect, it, vi } from "vitest";
import { ScenarioService, type ScenarioServiceOptions } from "../scenario.service";

describe("ScenarioService.listTestSuites", () => {
  describe("when the caller asks for archived suites too", () => {
    /** @scenario "Listing test suites with archived ones included answers" */
    it("hands the project and the archived flag to the repository", async () => {
      const findTestSuites = vi.fn().mockResolvedValue([]);
      const service = ScenarioService.create({
        repository: { findTestSuites } as unknown as ScenarioServiceOptions["repository"],
        simulations: {} as ScenarioServiceOptions["simulations"],
        ids: {} as ScenarioServiceOptions["ids"],
        testSuiteIds: {} as ScenarioServiceOptions["testSuiteIds"],
        clock: {} as ScenarioServiceOptions["clock"],
        secretCipher: {} as ScenarioServiceOptions["secretCipher"],
      });

      await expect(
        service.listTestSuites({ projectId: "project_1", includeArchived: true }),
      ).resolves.toEqual([]);

      expect(findTestSuites).toHaveBeenCalledWith({ projectId: "project_1", includeArchived: true });
    });
  });
});
