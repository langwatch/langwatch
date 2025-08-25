import { Hono } from "hono";

import { authMiddleware, handleError } from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";

import { app as appV1 } from "./app.v1";

import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

patchZodOpenapi();

function createDatasetApp() {
  const app = new Hono();

  app.use(loggerMiddleware());
  app.use(authMiddleware);

  // https://hono.dev/docs/api/hono#error-handling
  app.onError(handleError);

  app.route("/", appV1);

  return app;
}

const root = new Hono();
const datasets = createDatasetApp();

root.route("/api/datasets", datasets);
root.route("/api/dataset", datasets);

export default root;
