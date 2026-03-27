import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { badRequestSchema, successSchema } from "~/app/api/shared/schemas";
import {
  commitMessageSchema,
  versionSchema,
} from "~/prompts/schemas/field-schemas";
import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { afterPromptCreated } from "~/../ee/billing/nurturing/hooks/promptCreation";
import { prisma } from "~/server/db";
import { NotFoundError } from "~/server/prompt-config/errors";
import { LabelValidationError } from "~/server/prompt-config/repositories/llm-config-label.repository";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  type OrganizationMiddlewareVariables,
  organizationMiddleware,
  resourceLimitMiddleware,
} from "../../middleware";
import {
  type PromptServiceMiddlewareVariables,
  promptServiceMiddleware,
} from "../../middleware/prompt-service";
import { baseResponses, conflictResponses } from "../../shared/base-responses";
import {
  type ApiResponsePrompt,
  apiResponsePromptWithVersionDataSchema,
  createPromptInputSchema,
  updatePromptInputSchema,
} from "./schemas";
import {
  buildStandardSuccessResponse,
  handlePossibleConflictError,
} from "./utils";
import { handleSystemPromptConflict } from "./utils/handle-system-prompt-conflict";

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
      apiResponsePromptWithVersionDataSchema.array().parse(configs),
    );
  },
);

// Assign label to a prompt version
const assignLabelResponseSchema = z.object({
  configId: z.string(),
  versionId: z.string(),
  label: z.string(),
  updatedAt: z.date(),
});

app.put(
  "/:id{.+?}/labels/:label",
  describeRoute({
    description:
      'Assign a label (e.g. "production", "staging") to a specific prompt version',
    parameters: [
      {
        name: "label",
        in: "path",
        description: 'The label to assign (e.g., "production", "staging")',
        required: true,
        schema: { type: "string", enum: ["production", "staging"] },
      },
    ],
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(assignLabelResponseSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
      422: {
        description: "Invalid label or version",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator("json", z.object({ versionId: z.string() })),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id, label } = c.req.param();
    const { versionId } = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id, label, versionId },
      "Assigning label to prompt version",
    );

    try {
      const config = await service.repository.getPromptByIdOrHandle({
        idOrHandle: id,
        projectId: project.id,
        organizationId: organization.id,
      });

      if (!config) {
        throw new HTTPException(404, {
          message: `Prompt not found: ${id}`,
        });
      }

      const result = await service.assignLabel({
        configId: config.id,
        versionId,
        label,
        projectId: project.id,
      });

      logger.info(
        { projectId: project.id, configId: config.id, label, versionId },
        "Successfully assigned label to prompt version",
      );

      return c.json(
        assignLabelResponseSchema.parse({
          configId: result.configId,
          versionId: result.versionId,
          label: result.label,
          updatedAt: result.updatedAt,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof LabelValidationError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      throw error;
    }
  },
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
        z.array(apiResponsePromptWithVersionDataSchema),
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
      "Getting versions for prompt",
    );

    const versions: ApiResponsePrompt[] = await service.getAllVersions({
      idOrHandle: id,
      projectId: project.id,
      organizationId: organization.id,
    });

    logger.info(
      { projectId: project.id, promptId: id, versionCount: versions.length },
      "Successfully retrieved prompt versions",
    );

    return c.json(
      apiResponsePromptWithVersionDataSchema.array().parse(versions),
    );
  },
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
      {
        name: "label",
        in: "query",
        description:
          'Fetch the version pointed to by this label (e.g., "production", "staging")',
        required: false,
        schema: { type: "string", enum: ["production", "staging"] },
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
    const label = c.req.query("label") ?? undefined;

    logger.info(
      { projectId: project.id, id, version, label },
      "Getting prompt",
    );

    try {
      const config = await service.getPromptByIdOrHandle({
        idOrHandle: id,
        projectId: project.id,
        organizationId: organization.id,
        version,
        label,
      });

      if (!config) {
        throw new HTTPException(404, {
          message: "Prompt not found",
        });
      }

      return c.json(apiResponsePromptWithVersionDataSchema.parse(config));
    } catch (error: unknown) {
      if (error instanceof LabelValidationError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, {
          message: error.message,
        });
      }
      throw error;
    }
  },
);

// Create prompt with initial version
app.post(
  "/",
  resourceLimitMiddleware("prompts"),
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
    const { labels, ...data } = c.req.valid("json");

    logger.info(
      {
        handle: data.handle,
        scope: data.scope,
        projectId: project.id,
        organizationId: organization.id,
        labels,
      },
      "Creating new prompt with initial version",
    );

    try {
      const newConfig: ApiResponsePrompt = await service.createPrompt({
        projectId: project.id,
        organizationId: organization.id,
        ...data,
      });

      logger.info(
        { promptId: newConfig.id },
        "Successfully created prompt with initial version",
      );

      if (labels && labels.length > 0) {
        await Promise.all(
          labels.map((label) =>
            service.assignLabel({
              configId: newConfig.id,
              versionId: newConfig.versionId,
              label,
              projectId: project.id,
            }),
          ),
        );

        logger.info(
          { promptId: newConfig.id, labels },
          "Assigned labels to initial version",
        );
      }

      afterPromptCreated({
        prisma,
        projectId: project.id,
      });

      return c.json(apiResponsePromptWithVersionDataSchema.parse(newConfig));
    } catch (error: any) {
      logger.error({ projectId: project.id, error }, "Error creating prompt");
      if (error instanceof LabelValidationError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      handlePossibleConflictError(error, data.scope);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  },
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
              }),
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
    }),
  ),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id },
      "Syncing prompt with local content",
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
        "Successfully synced prompt",
      );

      if (syncResult.action === "created") {
        afterPromptCreated({
          prisma,
          projectId: project.id,
        });
      }

      return c.json(response);
    } catch (error: any) {
      logger.error(
        { projectId: project.id, promptId: id, error },
        "Error syncing prompt",
      );

      if (error.message.includes("No permission")) {
        throw new HTTPException(403, {
          message: error.message,
        });
      }

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  },
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
    const { labels, ...data } = c.req.valid("json");
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
        labels,
      },
      "Updating prompt",
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

      if (labels && labels.length > 0) {
        await Promise.all(
          labels.map((label) =>
            service.assignLabel({
              configId: updatedConfig.id,
              versionId: updatedConfig.versionId,
              label,
              projectId,
            }),
          ),
        );

        logger.info(
          { projectId, promptId: id, labels, versionId: updatedConfig.versionId },
          "Assigned labels to updated version",
        );
      }

      logger.info(
        {
          projectId,
          promptId: id,
          handle: updatedConfig.handle,
          scope: updatedConfig.scope,
        },
        "Successfully updated prompt",
      );

      return c.json(
        apiResponsePromptWithVersionDataSchema.parse(updatedConfig),
      );
    } catch (error: any) {
      logger.error({ projectId, promptId: id, error }, "Error updating prompt");
      if (error instanceof LabelValidationError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      handlePossibleConflictError(error, data.scope);
      handleSystemPromptConflict(error);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  },
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
      organization.id,
    );

    logger.info(
      { projectId: project.id, promptId: id, success: result.success },
      "Successfully deleted prompt",
    );

    return c.json(successSchema.parse(result));
  },
);
