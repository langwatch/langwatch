import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createProjectApp } from "~/server/api/security";
import { registerTracesRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp({ basePath: "/api/traces" });

registerTracesRoutes(secured);

export const app = secured.hono;
