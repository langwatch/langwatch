import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { ScenarioExecutionLookupService } from "../scenario-execution-lookup.service.ts";
import { ScenarioProcessorService } from "../scenario-processor.service.ts";
import type { ScenarioService } from "../scenario.service.ts";

const FEATURE_KEY = "scenarios.simulator";
const PROJECT_ID = "project_test";

function fakeService<T extends object>(methods: Partial<T>): T {
  return Object.assign(Object.create(null), methods);
}

function lookupForAProjectWithNoModel() {
  const notConfigured = new ModelNotConfiguredError({
    featureKey: FEATURE_KEY,
    role: "DEFAULT",
    featureDisplayName: "Scenario simulator",
    projectId: PROJECT_ID,
  });
  const modelProviders = fakeService<ModelProviderApi>({
    findResolvedDefault: vi.fn().mockResolvedValue(null),
    resolveModelForFeature: vi.fn().mockRejectedValue(notConfigured),
  });

  return ScenarioExecutionLookupService.create({
    scenarios: fakeService<ScenarioService>({}),
    projects: fakeService<ProjectApi>({}),
    modelProviders,
  });
}

describe("ScenarioExecutionLookupService.resolveModel", () => {
  describe("when the project has no model for the simulator", () => {
    /** @scenario A project with no model for the simulator gets a run refused with the remediation message, logged as a warning, not an error */
    it("refuses with the remediation message and logs a warning, not an error", async () => {
      const failure = await lookupForAProjectWithNoModel()
        .resolveModel({ featureKey: FEATURE_KEY, projectId: PROJECT_ID })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ModelNotConfiguredError);
      expect((failure as ModelNotConfiguredError).message).toBe(
        `No model configured for "${FEATURE_KEY}" (role: DEFAULT, project: ${PROJECT_ID}).`,
      );

      const jobLogger = { warn: vi.fn(), error: vi.fn() };
      ScenarioProcessorService.logPrefetchFailure({
        jobLogger,
        prefetchResult: {
          success: false,
          error: (failure as ModelNotConfiguredError).message,
          reason: "model_not_configured",
        },
      });

      expect(jobLogger.error).not.toHaveBeenCalled();
      expect(jobLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "model_not_configured" }),
        expect.stringContaining("blocked by project configuration"),
      );
    });
  });
});
