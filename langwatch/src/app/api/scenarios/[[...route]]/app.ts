import { Hono } from "hono";
import { type AuthMiddlewareVariables, authMiddleware, handleError } from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { app as appV1 } from "./app.v1";

patchZodOpenapi();

export const app = new Hono<{ Variables: AuthMiddlewareVariables }>().basePath("/api/scenarios");

app.use(tracerMiddleware({ name: "scenarios" }));
app.use(loggerMiddleware());
app.use(authMiddleware);
app.onError(handleError);

app.route("/", appV1);
