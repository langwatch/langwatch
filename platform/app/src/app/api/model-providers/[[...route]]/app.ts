import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import type { ModelProviderServiceMiddlewareVariables } from "../../middleware/model-provider-service";
import type { OrganizationMiddlewareVariables } from "../../middleware/organization";
import { registerModelProviderRoutes } from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp<
  ModelProviderServiceMiddlewareVariables & OrganizationMiddlewareVariables
>({
  basePath: "/api/model-providers",
});

registerModelProviderRoutes(secured);

export const app = secured.hono;
