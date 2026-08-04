import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

import { registerQueryRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp({ basePath: "/api/query" });

registerQueryRoutes(secured);

export const app = secured.hono;
