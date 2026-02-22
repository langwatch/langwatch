import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  type OrganizationMiddlewareVariables,
  organizationMiddleware,
} from "../../middleware";
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

type Variables = ModelProviderServiceMiddlewareVariables &
  AuthMiddlewareVariables &
  OrganizationMiddlewareVariables;

export const app = new Hono<{
  Variables: Variables;
}>().basePath("/");

// Middleware
app.use("/*", organizationMiddleware);
app.use("/*", modelProviderServiceMiddleware);

// List all model providers
app.get(
  "/",
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

// Upsert a model provider
app.put(
  "/:provider",
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
      await service.updateModelProvider({
        projectId: project.id,
        provider,
        enabled: data.enabled,
        customKeys: data.customKeys as Record<string, unknown> | undefined,
        customModels: data.customModels,
        customEmbeddingsModels: data.customEmbeddingsModels,
        extraHeaders: data.extraHeaders,
        defaultModel: data.defaultModel,
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
