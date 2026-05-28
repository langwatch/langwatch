import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createProjectApp } from "~/server/api/security";
import { registerModelDefaultsRoutes } from "./app.v1";

patchZodOpenapi();

/**
 * Hono app for /api/model-defaults — REST CRUD for ModelDefaultConfig rows so
 * CLI / external API users can configure cascading default models without
 * going through the settings UI. Mirrors the tRPC surface
 * (saveDefaultModelsConfig, deleteDefaultModelsConfig,
 * getDefaultModelsForProject) — both call the same service layer in
 * langwatch/src/server/modelProviders/modelDefaults.{read,service}.ts so
 * behaviour stays consistent across the two entrypoints.
 */
const secured = createProjectApp({
  basePath: "/api/model-defaults",
  family: "model-defaults",
});

registerModelDefaultsRoutes(secured);

export const app = secured.hono;
