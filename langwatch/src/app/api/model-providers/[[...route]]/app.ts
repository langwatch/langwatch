import { Hono } from "hono";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { authMiddleware, handleError } from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { app as appV1 } from "./app.v1";

patchZodOpenapi();

// Define the Hono app
export const app = new Hono().basePath("/api/model-providers");

// Middleware
app.use(tracerMiddleware({ name: "model-providers" }));
app.use(loggerMiddleware());
app.use(authMiddleware);
// https://hono.dev/docs/api/hono#error-handling
app.onError(handleError);

app.route("/", appV1);
