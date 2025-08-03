import { PromptScope, type Organization, type Project } from "@prisma/client";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { validator as zValidator, resolver } from "hono-openapi/zod";
import { z } from "zod";

import { prisma } from "~/server/db";
import { PromptService } from "~/server/prompt-config/prompt.service";

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
} from "./utils";

import { badRequestSchema, successSchema } from "~/app/api/shared/schemas";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger";

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

    return c.json(configs);
  }
);

// Get prompt by ID
app.get(
  "/:id",
  describeRoute({
    description: "Get a specific prompt by ID",
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

    logger.info({ projectId: project.id, id }, "Getting prompt by ID");

    try {
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

      const response = {
        id: config.id,
        name: config.name,
        handle: config.handle,
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
      } satisfies z.infer<typeof promptOutputSchema>;

      return c.json(response);
    } catch (error) {
      logger.error(
        { projectId: project.id, id, error },
        "Error retrieving prompt"
      );

      throw error;
    }
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

    const newConfig = await service.createPrompt({
      name,
      projectId: project.id,
      handle: data.handle,
      organizationId: organization.id,
      scope: data.scope,
    });

    logger.info(
      { projectId: project.id, promptId: newConfig.id, promptName: name },
      "Successfully created new prompt"
    );

    return c.json(newConfig);
  }
);

// Get versions
app.get(
  "/:id/versions",
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
    const { id } = c.req.param();

    logger.info(
      { projectId: project.id, promptId: id },
      "Getting versions for prompt"
    );

    const versions = await service.repository.versions.getVersionsForConfigById(
      {
        configId: id,
        projectId: project.id,
      }
    );

    logger.info(
      { projectId: project.id, promptId: id, versionCount: versions.length },
      "Successfully retrieved prompt versions"
    );

    return c.json(versions);
  }
);

// Create version
app.post(
  "/:id/versions",
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
    const { id } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id, model: data.configData?.model },
      "Creating new version for prompt"
    );

    const version = await service.repository.versions.createVersion({
      ...data,
      configId: id,
      projectId: project.id,
    });

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

// Update prompt
app.put(
  "/:id",
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
        },
        "Successfully updated prompt"
      );

      return c.json(updatedConfig);
    } catch (error: any) {
      logger.error({ projectId, promptId: id, error }, "Error updating prompt");

      // Handle unique constraint violation for handle
      if (error.code === "P2002" && error.meta?.target?.includes("handle")) {
        throw new HTTPException(409, {
          message: "Prompt handle already exists",
        });
      }

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  }
);

// Delete prompt
app.delete(
  "/:id",
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
    const { id } = c.req.param();

    logger.info({ projectId: project.id, promptId: id }, "Deleting prompt");

    const result = await service.repository.deleteConfig(id, project.id);

    logger.info(
      { projectId: project.id, promptId: id, success: result.success },
      "Successfully deleted prompt"
    );

    return c.json(result satisfies z.infer<typeof successSchema>);
  }
);
