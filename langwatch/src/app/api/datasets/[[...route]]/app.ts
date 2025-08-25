import { Hono } from "hono";

import { authMiddleware, handleError } from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";

import { app as appV1 } from "./app.v1";

import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

patchZodOpenapi();

// Define the Hono app
export const app = new Hono().basePath("/api/datasets");

// Middleware
app.use(loggerMiddleware());
app.use(authMiddleware);
// https://hono.dev/docs/api/hono#error-handling
app.onError(handleError);

app.route("/", appV1);
