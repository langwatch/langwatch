import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { type SecuredApp, requires } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import type { AuthMiddlewareVariables } from "../../middleware/auth";
import type { OrganizationMiddlewareVariables } from "../../middleware/organization";
import { organizationMiddleware } from "../../middleware";
import {
  type ModelProviderServiceMiddlewareVariables,
  modelProviderServiceMiddleware,
} from "../../middleware/model-provider-service";
import { baseResponses } from "../../shared/base-responses";
import {
  apiResponseModelProvidersSchema,
  updateModelProviderInputSchema,
} from "./schemas";

const logger = createLogger("langwatch:api:model-providers");

patchZodOpenapi();

export type ModelProviderAppVariables = AuthMiddlewareVariables &
  ModelProviderServiceMiddlewareVariables &
  OrganizationMiddlewareVariables;

export function registerModelProviderRoutes(
  secured: SecuredApp<{ Variables: ModelProviderAppVariables }>,
): void {
  // organizationMiddleware + modelProviderServiceMiddleware run AFTER the
  // access chain (which authenticates and sets `project`), so they are
  // applied per-route rather than app-wide.

  // List all model providers — read scope, mirrors the tRPC modelProviders
  // getAll (project:view).
  secured.access(requires("project:view")).get(
    "/",
    organizationMiddleware,
    modelProviderServiceMiddleware,
    describeRoute({
    description: "List all model providers for a project with masked API keys",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(apiResponseModelProvidersSchema),
          },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("modelProviderService");
    const project = c.get("project");

    logger.info(
      { projectId: project.id },
      "Getting all model providers for project",
    );

    const providers = await service.getProjectModelProvidersForFrontend(
      project.id,
    );

    return c.json(apiResponseModelProvidersSchema.parse(providers));
  },
);

  // Upsert a model provider — write scope, mirrors the tRPC modelProviders
  // update (project:update).
  secured.access(requires("project:update")).put(
    "/:provider",
    organizationMiddleware,
    modelProviderServiceMiddleware,
    describeRoute({
      description: "Create or update a model provider",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(apiResponseModelProvidersSchema),
          },
        },
      },
      400: {
        description: "Bad request",
        content: {
          "application/json": {
            schema: resolver(z.object({ error: z.string() })),
          },
        },
      },
    },
  }),
  zValidator("json", updateModelProviderInputSchema),
  async (c) => {
    const service = c.get("modelProviderService");
    const project = c.get("project");
    const { provider } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, provider },
      "Upserting model provider",
    );

    try {
      // Ensure defaultModel has the provider prefix (e.g. "openai/gpt-4o")
      // required by litellm for routing
      let defaultModel = data.defaultModel;
      if (defaultModel && !defaultModel.includes("/")) {
        defaultModel = `${provider}/${defaultModel}`;
      }

      // REST endpoint is keyed on the provider string in the URL and
      // preserves the legacy single-instance upsert contract. The
      // multi-instance create flow lives behind the tRPC `update`
      // procedure, which goes through the id-based path.
      await service.upsertByProviderKey({
        projectId: project.id,
        provider,
        enabled: data.enabled,
        customKeys: data.customKeys as Record<string, unknown> | undefined,
        customModels: data.customModels,
        customEmbeddingsModels: data.customEmbeddingsModels,
        extraHeaders: data.extraHeaders,
        defaultModel,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }

    // Return updated providers list with masked keys
    const providers = await service.getProjectModelProvidersForFrontend(
      project.id,
    );

    logger.info(
      { projectId: project.id, provider },
      "Successfully upserted model provider",
    );

    return c.json(apiResponseModelProvidersSchema.parse(providers));
  },
  );
}
