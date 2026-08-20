import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { registerScenarioRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp({ basePath: "/api/scenarios" });

registerScenarioRoutes(secured);

export const app = secured.hono;
