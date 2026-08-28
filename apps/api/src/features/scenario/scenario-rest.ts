import type { ScenarioService } from "@langwatch/scenario-contract";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  type PlatformUrlBuilder,
  type SecuredApp,
} from "../../app-rest";
import { registerScenarioRoutes } from "./scenario-rest.v1";

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
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const secured = options.security.createProjectApp({ basePath: "/api/scenarios" });

  registerScenarioRoutes(secured, {
    scenarios: options.scenarios,
    platformUrl: options.platformUrl,
  });

  return secured;
}
