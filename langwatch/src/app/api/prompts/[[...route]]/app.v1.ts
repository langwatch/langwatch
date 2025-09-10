import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { validator as zValidator, resolver } from "hono-openapi/zod";
import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import {
  organizationMiddleware,
  type AuthMiddlewareVariables,
  type OrganizationMiddlewareVariables,
} from "../../middleware";
import {
  promptServiceMiddleware,
  type PromptServiceMiddlewareVariables,
} from "../../middleware/prompt-service";
import { baseResponses, conflictResponses } from "../../shared/base-responses";

import {
  apiResponsePromptWithVersionDataSchema,
  createPromptInputSchema,
  updatePromptInputSchema,
  type ApiResponsePrompt,
} from "./schemas";
import { buildStandardSuccessResponse } from "./utils";
import { handlePossibleConflictError } from "./utils";
import { handleSystemPromptConflict } from "./utils/handle-system-prompt-conflict";

import { badRequestSchema, successSchema } from "~/app/api/shared/schemas";
import {
  commitMessageSchema,
  versionSchema,
} from "~/prompt-configs/schemas/field-schemas";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:api:prompts");

patchZodOpenapi();

// Define types for our Hono context variables
type Variables = PromptServiceMiddlewareVariables &
  AuthMiddlewareVariables &
  OrganizationMiddlewareVariables;

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/");

// Middleware
app.use("/*", organizationMiddleware);
app.use("/*", promptServiceMiddleware);

// Get all prompts
app.get(
  "/",
  describeRoute({
    description: "Get all prompts for a project",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(z.array(apiResponsePromptWithVersionDataSchema)),
          },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");

    logger.info({ projectId: project.id }, "Getting all prompts for project");

    const configs: ApiResponsePrompt[] = await service.getAllPrompts({
      projectId: project.id,
      organizationId: organization.id,
      version: "latest",
    });

    return c.json(
      apiResponsePromptWithVersionDataSchema.array().parse(configs)
    );
  }
);

// Get versions
app.get(
  "/:id{.+?}/versions",
  describeRoute({
    description:
      "Get all versions for a prompt. Does not include base prompt data, only versioned data.",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(
        z.array(apiResponsePromptWithVersionDataSchema)
      ),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();

    logger.info(
      { projectId: project.id, promptId: id },
      "Getting versions for prompt"
    );

    const versions: ApiResponsePrompt[] = await service.getAllVersions({
      idOrHandle: id,
      projectId: project.id,
      organizationId: organization.id,
    });

    logger.info(
      { projectId: project.id, promptId: id, versionCount: versions.length },
      "Successfully retrieved prompt versions"
    );

    return c.json(
      apiResponsePromptWithVersionDataSchema.array().parse(versions)
    );
  }
);

// Get prompt by ID
app.get(
  "/:id{.+}",
  describeRoute({
    description: "Get a specific prompt",
    parameters: [
      {
        name: "version",
        in: "query",
        description: "Specific version number to retrieve",
        required: false,
        schema: { type: "integer", minimum: 0 },
      },
    ],
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(apiResponsePromptWithVersionDataSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();
    const version = c.req.query("version")
      ? parseInt(c.req.query("version")!)
      : undefined;

    logger.info({ projectId: project.id, id, version }, "Getting prompt");

    const config = await service.getPromptByIdOrHandle({
      idOrHandle: id,
      projectId: project.id,
      organizationId: organization.id,
      version,
    });

    if (!config) {
      throw new HTTPException(404, {
        message: "Prompt not found",
      });
    }

    return c.json(apiResponsePromptWithVersionDataSchema.parse(config));
  }
);

// Create prompt with initial version
app.post(
  "/",
  describeRoute({
    description: "Create a new prompt with default initial version",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(apiResponsePromptWithVersionDataSchema),
      409: conflictResponses[409],
    },
  }),
  zValidator("json", createPromptInputSchema),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const data = c.req.valid("json");

    logger.info(
      {
        handle: data.handle,
        scope: data.scope,
        projectId: project.id,
        organizationId: organization.id,
      },
      "Creating new prompt with initial version"
    );

    try {
      const newConfig: ApiResponsePrompt = await service.createPrompt({
        projectId: project.id,
        organizationId: organization.id,
        ...data,
      });

      logger.info(
        { promptId: newConfig.id },
        "Successfully created prompt with initial version"
      );

      return c.json(apiResponsePromptWithVersionDataSchema.parse(newConfig));
    } catch (error: any) {
      logger.error({ projectId: project.id, error }, "Error creating prompt");
      handlePossibleConflictError(error, data.scope);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  }
);

// Sync endpoint for upsert operations
app.post(
  "/:id{.+?}/sync",
  describeRoute({
    description: "Sync/upsert a prompt with local content",
    responses: {
      ...baseResponses,
      200: {
        description: "Sync result",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                action: z.enum([
                  "created",
                  "updated",
                  "conflict",
                  "up_to_date",
                ]),
                prompt: apiResponsePromptWithVersionDataSchema.optional(),
                conflictInfo: z
                  .object({
                    localVersion: z.number(),
                    remoteVersion: z.number(),
                    differences: z.array(z.string()),
                    remoteConfigData:
                      getLatestConfigVersionSchema().shape.configData,
                  })
                  .optional(),
              })
            ),
          },
        },
      },
    },
  }),
  zValidator(
    "json",
    z.object({
      configData: getLatestConfigVersionSchema().shape.configData,
      localVersion: versionSchema.optional(),
      commitMessage: commitMessageSchema.optional(),
    })
  ),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id },
      "Syncing prompt with local content"
    );

    try {
      const syncResult = await service.syncPrompt({
        idOrHandle: id,
        localConfigData: data.configData,
        localVersion: data.localVersion,
        projectId: project.id,
        organizationId: organization.id,
        commitMessage: data.commitMessage,
      });

      const response: any = {
        action: syncResult.action,
      };

      if (syncResult.prompt) {
        response.prompt = syncResult.prompt;
      }

      if (syncResult.conflictInfo) {
        response.conflictInfo = syncResult.conflictInfo;
      }

      logger.info(
        {
          projectId: project.id,
          promptId: id,
          action: syncResult.action,
        },
        "Successfully synced prompt"
      );

      return c.json(response);
    } catch (error: any) {
      logger.error(
        { projectId: project.id, promptId: id, error },
        "Error syncing prompt"
      );

      if (error.message.includes("No permission")) {
        throw new HTTPException(403, {
          message: error.message,
        });
      }

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  }
);

// Update prompt
app.put(
  "/:id{.+}",
  describeRoute({
    description: "Update a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(apiResponsePromptWithVersionDataSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
      409: conflictResponses[409],
      422: {
        description: "Invalid input",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator("json", updatePromptInputSchema),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const { id } = c.req.param();
    const data = c.req.valid("json");
    const projectId = project.id;

    if (Object.keys(data).length === 0) {
      throw new HTTPException(422, {
        message: "At least one field is required",
      });
    }

    logger.info(
      {
        projectId: project.id,
        handleOrId: id,
        data,
      },
      "Updating prompt"
    );

    try {
      const updatedConfig: ApiResponsePrompt = await service.updatePrompt({
        idOrHandle: id,
        projectId,
        data,
      });

      if (!updatedConfig) {
        throw new HTTPException(404, {
          message: `Prompt not found: ${id}`,
        });
      }

      logger.info(
        {
          projectId,
          promptId: id,
          handle: updatedConfig.handle,
          scope: updatedConfig.scope,
        },
        "Successfully updated prompt"
      );

      return c.json(
        apiResponsePromptWithVersionDataSchema.parse(updatedConfig)
      );
    } catch (error: any) {
      logger.error({ projectId, promptId: id, error }, "Error updating prompt");
      handlePossibleConflictError(error, data.scope);
      handleSystemPromptConflict(error);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  }
);
// Delete prompt
app.delete(
  "/:id{.+}",
  describeRoute({
    description: "Delete a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(successSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();

    logger.info({ projectId: project.id, promptId: id }, "Deleting prompt");

    const result = await service.repository.deleteConfig(
      id,
      project.id,
      organization.id
    );

    logger.info(
      { projectId: project.id, promptId: id, success: result.success },
      "Successfully deleted prompt"
    );

    return c.json(successSchema.parse(result));
  }
);
