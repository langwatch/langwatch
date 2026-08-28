import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "@langwatch/platform-api/app-rest";
import type { OrganizationMiddlewareVariables } from "../../middleware/organization";
import { registerPromptRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp<OrganizationMiddlewareVariables>({
  basePath: "/api/prompts",
});

registerPromptRoutes(secured);

export const app = secured.hono;
