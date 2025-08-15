import { Hono } from "hono";

import { authMiddleware, handleError } from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { evaluationServiceMiddleware } from "../middleware/evaluation-service";

import { app as appV1 } from "./app.v1";
type Variables = Parameters<typeof appV1["route"]>[1] extends Hono<infer T> ? T["Variables"] : never;

import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

patchZodOpenapi();

// Define the Hono app
export const app = new Hono<{ Variables: Variables }>().basePath("/api/evaluations");

// Middleware
app.use(loggerMiddleware());
app.use(authMiddleware);
app.use(evaluationServiceMiddleware);
// https://hono.dev/docs/api/hono#error-handling
app.onError(handleError);

app.route("/", appV1);
