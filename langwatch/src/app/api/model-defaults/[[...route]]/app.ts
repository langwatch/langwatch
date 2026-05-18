import { Hono } from "hono";

import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { authMiddleware, handleError } from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { app as appV1 } from "./app.v1";

patchZodOpenapi();

/**
 * Hono app for /api/model-defaults — REST CRUD for ModelDefaultConfig
 * rows so CLI / external API users can configure cascading default
 * models without going through the settings UI. Mirrors the tRPC
 * surface (saveDefaultModelsConfig, deleteDefaultModelsConfig,
 * getDefaultModelsForProject) — both call the same service layer in
 * langwatch/src/server/modelProviders/modelDefaults.{read,service}.ts
 * so behaviour stays consistent across the two entrypoints.
 */
export const app = new Hono().basePath("/api/model-defaults");

app.use(tracerMiddleware({ name: "model-defaults" }));
app.use(loggerMiddleware());
app.use(authMiddleware);
app.onError(handleError);

app.route("/", appV1);
