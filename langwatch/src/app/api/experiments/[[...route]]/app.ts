import { Hono } from "hono";

import { authMiddleware, handleError } from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";

import { app as appV1 } from "./app.v1";

import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { experimentServiceMiddleware } from "../middleware/experiment-service";

patchZodOpenapi();

// Define the Hono app
export const app = new Hono().basePath("/api/experiments");

// Middleware
app.use(loggerMiddleware());
app.use(authMiddleware);
app.use("/*", experimentServiceMiddleware);
// https://hono.dev/docs/api/hono#error-handling
app.onError(handleError);

app.route("/", appV1);
