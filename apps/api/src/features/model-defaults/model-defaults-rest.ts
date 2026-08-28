import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  type SecuredApp,
} from "../../app-rest";
import { registerModelDefaultsRoutes } from "./model-defaults-rest.v1";

/**
 * Hono app for /api/model-defaults — REST CRUD for ModelDefaultConfig rows so
 * CLI / external API users can configure cascading default models without
 * going through the settings UI. Mirrors the tRPC surface
 * (saveDefaultModelsConfig, deleteDefaultModelsConfig,
 * getDefaultModelsForProject) — both call the same service layer in
 * platform/app/src/server/modelProviders/modelDefaults.{read,service}.ts so
 * behaviour stays consistent across the two entrypoints.
 */
export function createModelDefaultsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  modelProviders: () => ModelProviderService;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const secured = options.security.createProjectApp({
    basePath: "/api/model-defaults",
  });

  registerModelDefaultsRoutes(secured, options.modelProviders);

  return secured;
}
