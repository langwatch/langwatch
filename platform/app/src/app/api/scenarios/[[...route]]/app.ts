import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "@langwatch/platform-api/app-rest";
import { registerScenarioRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp({ basePath: "/api/scenarios" });

registerScenarioRoutes(secured);

export const app = secured.hono;
