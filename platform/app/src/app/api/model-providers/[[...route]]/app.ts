import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "@langwatch/platform-api/app-rest";
import type { OrganizationMiddlewareVariables } from "../../middleware/organization";
import { registerModelProviderRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp<OrganizationMiddlewareVariables>({
  basePath: "/api/model-providers",
});

registerModelProviderRoutes(secured);

export const app = secured.hono;
