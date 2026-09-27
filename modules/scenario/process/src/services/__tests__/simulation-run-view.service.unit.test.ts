import { createApiFixture } from "@langwatch/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { ScenarioPlatformLinkService } from "../scenario-platform-link.service.ts";
import { SimulationRunViewService } from "../simulation-run-view.service.ts";

const PROJECT_ID = "project_1";

function serviceOver(simulations: Partial<SimulationService>): SimulationRunViewService {
  return SimulationRunViewService.create({
    simulations: createApiFixture<SimulationService>(simulations),
    platformLinks: ScenarioPlatformLinkService.create({
      featureFlags: createApiFixture<Pick<FeatureFlagApi, "isEnabled">>({}),
      projects: createApiFixture<Pick<ProjectApi, "getOrganizationId">>({}),
      publicBaseUrl: undefined,
    }),
  });
}

describe("SimulationRunViewService", () => {
  describe("given a run id the project does not hold", () => {
    it("refuses the run state as not found", async () => {
      const service = serviceOver({ findScenarioRunData: async () => null });

      await expect(
        service.getRunState({ projectId: PROJECT_ID, scenarioRunId: "scenariorun_1" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("refuses the public run as simulation_run_not_found", async () => {
      const service = serviceOver({ findScenarioRunData: async () => null });

      await expect(
        service.getRun({
          projectId: PROJECT_ID,
          projectSlug: "acme",
          scenarioRunId: "scenariorun_1",
        }),
      ).rejects.toMatchObject({ code: "simulation_run_not_found" });
    });
  });

  describe("given a batch id the project does not hold", () => {
    it("refuses the summary as batch_run_not_found", async () => {
      const service = serviceOver({ findBatchSummary: async () => null });

      await expect(
        service.getBatchSummary({ projectId: PROJECT_ID, batchRunId: "batch_1" }),
      ).rejects.toMatchObject({ code: "batch_run_not_found" });
    });
  });
});
