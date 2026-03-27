import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { validateProviderApiKey } from "~/server/modelProviders/providerValidation";
import { modelProviders } from "~/server/modelProviders/registry";
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
import { NotFoundError } from "../../shared/errors";
import {
  apiResponseModelProviderSchema,
  apiResponseModelProvidersSchema,
  updateModelProviderInputSchema,
  validateModelProviderInputSchema,
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
      // Ensure defaultModel has the provider prefix (e.g. "openai/gpt-4o")
      // required by litellm for routing
      let defaultModel = data.defaultModel;
      if (defaultModel && !defaultModel.includes("/")) {
        defaultModel = `${provider}/${defaultModel}`;
      }

      await service.updateModelProvider({
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

// Get a single model provider
app.get(
  "/:provider",
  describeRoute({
    description: "Get a single model provider by key with masked API keys",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(apiResponseModelProviderSchema),
          },
        },
      },
      404: {
        description: "Provider not found",
        content: {
          "application/json": {
            schema: resolver(z.object({ error: z.string() })),
          },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("modelProviderService");
    const project = c.get("project");
    const { provider } = c.req.param();

    if (!(provider in modelProviders)) {
      throw new NotFoundError(`Provider "${provider}" not found in registry`);
    }

    logger.info(
      { projectId: project.id, provider },
      "Getting single model provider",
    );

    const providers = await service.getProjectModelProvidersForFrontend(
      project.id,
    );

    const providerData = providers[provider];
    if (!providerData) {
      throw new NotFoundError(`Provider "${provider}" not found`);
    }

    return c.json(apiResponseModelProviderSchema.parse(providerData));
  },
);

// Delete a model provider
app.delete(
  "/:provider",
  describeRoute({
    description: "Delete a model provider's stored configuration",
    responses: {
      ...baseResponses,
      204: {
        description: "No Content",
      },
      404: {
        description: "Provider not found",
        content: {
          "application/json": {
            schema: resolver(z.object({ error: z.string() })),
          },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("modelProviderService");
    const project = c.get("project");
    const { provider } = c.req.param();

    if (!(provider in modelProviders)) {
      throw new NotFoundError(`Provider "${provider}" not found in registry`);
    }

    logger.info(
      { projectId: project.id, provider },
      "Deleting model provider",
    );

    await service.deleteModelProvider({
      projectId: project.id,
      provider,
    });

    logger.info(
      { projectId: project.id, provider },
      "Successfully deleted model provider",
    );

    return c.body(null, 204);
  },
);

// Validate a model provider's API key
app.post(
  "/:provider/validate",
  describeRoute({
    description: "Validate API key credentials for a model provider",
    responses: {
      ...baseResponses,
      200: {
        description: "Validation result",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                valid: z.boolean(),
                error: z.string().optional(),
              }),
            ),
          },
        },
      },
    },
  }),
  zValidator("json", validateModelProviderInputSchema),
  async (c) => {
    const project = c.get("project");
    const { provider } = c.req.param();
    const { customKeys } = c.req.valid("json");

    if (!(provider in modelProviders)) {
      throw new NotFoundError(`Provider "${provider}" not found in registry`);
    }

    logger.info(
      { projectId: project.id, provider },
      "Validating model provider API key",
    );

    const result = await validateProviderApiKey(provider, customKeys);

    logger.info(
      { projectId: project.id, provider, valid: result.valid },
      "Model provider API key validation complete",
    );

    return c.json(result);
  },
);
