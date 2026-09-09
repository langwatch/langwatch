import type { ScenarioService } from "@langwatch/scenario-contract";
import {
  type AppRestSecurity,
  type MountableRestApp,
  type PlatformUrlBuilder,
} from "@langwatch/api/rest";
import { registerScenarioRoutes, scenarioRestErrorHandler } from "./scenario-v1.api.ts";

/**
 * REST for the scenarios (test cases) a project defines, and their version
 * history.
 *
 * The scenario capability arrives as a per-request provider rather than off
 * the Hono context, so this family can be mounted into any process that has
 * one and built with none by the OpenAPI generator.
 */
export function createScenariosRestApp(options: {
  security: AppRestSecurity;
  scenarios: () => ScenarioService;
  platformUrl: PlatformUrlBuilder;
}): MountableRestApp {
  const family = options.security.createProjectVersionedApp({
    name: "scenarios",
    basePath: "/api/scenarios",
    errorEnvelope: "legacy",
    errorHandler: scenarioRestErrorHandler,
  });

  registerScenarioRoutes(family, {
    scenarios: options.scenarios,
    platformUrl: options.platformUrl,
  });

  return family.service.build();
}
