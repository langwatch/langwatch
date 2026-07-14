import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createProjectApp } from "~/server/api/security";
import type { OrganizationMiddlewareVariables } from "../../middleware/organization";
import type { PromptServiceMiddlewareVariables } from "../../middleware/prompt-service";
import { registerPromptRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp<
  PromptServiceMiddlewareVariables & OrganizationMiddlewareVariables
>({
  basePath: "/api/prompts",
});

registerPromptRoutes(secured);

export const app = secured.hono;
