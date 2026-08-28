import { createProjectApp } from "~/server/api/security";
import type { OrganizationMiddlewareVariables } from "../../middleware/organization";
import { registerPromptRoutes } from "./app.v1";

const secured = createProjectApp<OrganizationMiddlewareVariables>({
  basePath: "/api/prompts",
});

registerPromptRoutes(secured);

export const app = secured.hono;
