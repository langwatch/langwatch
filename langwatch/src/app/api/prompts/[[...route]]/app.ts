import { PromptScope, type Organization, type Project } from "@prisma/client";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { validator as zValidator, resolver } from "hono-openapi/zod";
import { z } from "zod";

import { badRequestSchema, successSchema } from "~/app/api/shared/schemas";
import { prisma } from "~/server/db";
import { PromptService } from "~/server/prompt-config/prompt.service";
import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger";

import {
  authMiddleware,
  handleError,
  organizationMiddleware,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { baseResponses } from "../../shared/base-responses";

import {
  llmPromptConfigSchema,
  promptOutputSchema,
  versionInputSchema,
  versionOutputSchema,
} from "./schemas";
import {
  buildStandardSuccessResponse,
  getOutputsToResponseFormat,
  patchHonoOpenApiSpecFix,
} from "./utils";

const logger = createLogger("langwatch:api:prompts");

patchZodOpenapi();

// Define types for our Hono context variables
type Variables = {
  project: Project;
  organization: Organization;
  promptService: PromptService;
};

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/prompts");

// Middleware
app.use(loggerMiddleware());
app.use("/*", authMiddleware);
app.use("/*", organizationMiddleware);
app.use("/*", async (c, next) => {
  c.set("promptService", new PromptService(prisma));
  await next();
});
// https://hono.dev/docs/api/hono#error-handling
app.onError(handleError);

patchHonoOpenApiSpecFix(app);

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
          "application/json": { schema: resolver(z.array(promptOutputSchema)) },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");

    logger.info({ projectId: project.id }, "Getting all prompts for project");

    const configs = await service.repository.getAllWithLatestVersion({
      projectId: project.id,
      organizationId: organization.id,
    });

    logger.info(
      { projectId: project.id, count: configs.length },
      "Retrieved prompts for project"
    );

    const transformedConfigs = configs.map((config) =>
      transformConfigToPromptOutput(config, config.id)
    );

    return c.json(
      transformedConfigs satisfies z.infer<typeof promptOutputSchema>[]
    );
  }
);

// Create prompt with initial version
// TODO: Consider allowing for the initial version to be customized via params
app.post(
  "/",
  describeRoute({
    description: "Create a new prompt with default initial version",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(promptOutputSchema),
    },
  }),
  zValidator(
    "json",
    z.object({
      name: z.string().min(1, "Name cannot be empty"),
      handle: z.string().optional(),
      scope: z.nativeEnum(PromptScope).default(PromptScope.PROJECT),
    })
  ),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const data = c.req.valid("json");
    const { name } = data;

    logger.info(
      { projectId: project.id, promptName: name },
      "Creating new prompt with initial version"
    );

    try {
      const newConfig = await service.createPrompt({
        name,
        projectId: project.id,
        handle: data.handle,
        organizationId: organization.id,
        scope: data.scope,
      });

      logger.info(
        { projectId: project.id, promptId: newConfig.id, promptName: name },
        "Successfully created prompt with initial version"
      );

      return c.json(newConfig);
    } catch (error: any) {
      logger.error({ projectId: project.id, error }, "Error creating prompt");

      // Handle unique constraint violation for handle
      if (error.code === "P2002" && error.meta?.target?.includes("handle")) {
        throw new HTTPException(409, {
          message: `Prompt handle already exists for ${data.scope as string}`,
        });
      }

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  }
);

// Get versions
app.get(
  "/:id{.+?}/versions",
  describeRoute({
    description: "Get all versions for a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(versionOutputSchema),
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

    const versions =
      await service.repository.versions.getVersionsForConfigByIdOrHandle({
        idOrHandle: id,
        projectId: project.id,
        organizationId: organization.id,
      });

    logger.info(
      { projectId: project.id, promptId: id, versionCount: versions.length },
      "Successfully retrieved prompt versions"
    );

    return c.json(versions);
  }
);

// Create version
app.post(
  "/:id{.+?}/versions",
  describeRoute({
    description: "Create a new version for a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(versionOutputSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator("json", versionInputSchema),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id, model: data.configData?.model },
      "Creating new version for prompt"
    );

    const version = await service.repository.versions.createVersion(
      {
        ...data,
        configId: id,
        projectId: project.id,
      },
      organization.id
    );

    logger.info(
      {
        projectId: project.id,
        promptId: id,
        versionId: version.id,
        version: version.version,
      },
      "Successfully created new prompt version"
    );

    return c.json(version);
  }
);

// Get prompt by ID
app.get(
  "/:id{.+}",
  describeRoute({
    description: "Get a specific prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(promptOutputSchema),
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

    logger.info({ projectId: project.id, id }, "Getting prompt");

    const config = await service.getPromptByIdOrHandle({
      idOrHandle: id,
      projectId: project.id,
      organizationId: organization.id,
    });

    if (!config) {
      throw new HTTPException(404, {
        message: "Prompt not found",
      });
    }

    const response = transformConfigToPromptOutput(config, id);

    return c.json(response);
  }
);

// Update prompt
app.put(
  "/:id{.+}",
  describeRoute({
    description: "Update a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(llmPromptConfigSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator(
    "json",
    z.object({
      name: z.string().min(1, "Name cannot be empty"),
      handle: z.string().optional(),
      scope: z.nativeEnum(PromptScope).optional(),
    })
  ),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const { id } = c.req.param();
    const data = c.req.valid("json");
    const projectId = project.id;

    logger.info(
      {
        projectId: project.id,
        promptId: id,
        newName: data.name,
        newHandle: data.handle,
        newScope: data.scope,
      },
      "Updating prompt"
    );

    try {
      const updatedConfig = await service.updatePrompt({
        id,
        projectId,
        data,
      });

      logger.info(
        {
          projectId,
          promptId: id,
          name: updatedConfig.name,
          handle: updatedConfig.handle,
          scope: updatedConfig.scope,
        },
        "Successfully updated prompt"
      );

      return c.json(updatedConfig);
    } catch (error: any) {
      logger.error({ projectId, promptId: id, error }, "Error updating prompt");

      // Handle unique constraint violation for handle
      if (error.code === "P2002" && error.meta?.target?.includes("handle")) {
        throw new HTTPException(409, {
          message: `Prompt handle already exists for scope`,
        });
      }

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

    return c.json(result satisfies z.infer<typeof successSchema>);
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
                prompt: promptOutputSchema.optional(),
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
      localVersion: z.number().optional(),
      commitMessage: z.string().optional(),
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
        response.prompt = transformConfigToPromptOutput(syncResult.prompt, id);
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

// Helper function to transform config to promptOutputSchema format
const transformConfigToPromptOutput = (
  config: any,
  id: string
): z.infer<typeof promptOutputSchema> => {
  return {
    id,
    name: config.name,
    handle: config.handle,
    scope: config.scope,
    version: config.latestVersion.version,
    versionId: config.latestVersion.id ?? "",
    versionCreatedAt: config.latestVersion.createdAt ?? new Date(),
    model: config.latestVersion.configData.model,
    prompt: config.latestVersion.configData.prompt,
    updatedAt: config.updatedAt,
    messages: [
      {
        role: "system",
        content: config.latestVersion.configData.prompt,
      },
      ...config.latestVersion.configData.messages,
    ],
    response_format: getOutputsToResponseFormat(config),
  };
};
