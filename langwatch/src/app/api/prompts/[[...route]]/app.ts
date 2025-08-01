import type { Project } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describeRoute } from "hono-openapi";
import { validator as zValidator, resolver } from "hono-openapi/zod";
import { z } from "zod";

import { type LlmConfigRepository } from "~/server/prompt-config/repositories/llm-config.repository";

import {
  authMiddleware,
  repositoryMiddleware,
  errorMiddleware,
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
  llmConfigRepository: LlmConfigRepository;
};

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/prompts");

// Middleware
app.use(loggerMiddleware());
app.use("/*", authMiddleware);
app.use("/*", repositoryMiddleware);
app.use("/*", errorMiddleware);

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
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");

    logger.info({ projectId: project.id }, "Getting all prompts for project");

    const configs = await repository.getAllWithLatestVersion(project.id);

    logger.info(
      { projectId: project.id, count: configs.length },
      "Retrieved prompts for project"
    );

    return c.json(configs);
  }
);

// Get prompt by ID
app.get(
  "/:idOrReferenceId",
  describeRoute({
    description: "Get a specific prompt by ID or reference ID",
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
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const { idOrReferenceId } = c.req.param();

    logger.info(
      { projectId: project.id, idOrReferenceId },
      "Getting prompt by ID"
    );

    try {
      const config =
        await repository.getConfigByIdOrReferenceIddWithLatestVersion(
          idOrReferenceId,
          project.id
        );

      const response = {
        id: config.id,
        name: config.name,
        referenceId: config.referenceId,
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
      if (error instanceof TRPCError) {
        return c.json(
          { error: error.message },
          getHTTPStatusCodeFromError(error) as ContentfulStatusCode
        );
      }

      logger.error(
        { projectId: project.id, idOrReferenceId, error },
        "Error retrieving prompt"
      );

      return c.json({ error: "internal server error" }, 500);
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
    z.object({ name: z.string().min(1, "Name cannot be empty") })
  ),
  async (c) => {
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const data = c.req.valid("json");
    const { name } = data;

    logger.info(
      { projectId: project.id, promptName: name },
      "Creating new prompt with initial version"
    );

    const newConfig = await repository.createConfigWithInitialVersion({
      name,
      projectId: project.id,
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
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const { id } = c.req.param();

    logger.info(
      { projectId: project.id, promptId: id },
      "Getting versions for prompt"
    );

    const versions = await repository.versions.getVersionsForConfigById({
      configId: id,
      projectId: project.id,
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
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const { id } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id, model: data.configData?.model },
      "Creating new version for prompt"
    );

    const version = await repository.versions.createVersion({
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
    z.object({ name: z.string().min(1, "Name cannot be empty") })
  ),
  async (c) => {
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const { id } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id, newName: data.name },
      "Updating prompt"
    );

    const updatedConfig = await repository.updateConfig(id, project.id, data);

    logger.info(
      { projectId: project.id, promptId: id, name: updatedConfig.name },
      "Successfully updated prompt"
    );

    return c.json(updatedConfig);
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
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const { id } = c.req.param();

    logger.info({ projectId: project.id, promptId: id }, "Deleting prompt");

    const result = await repository.deleteConfig(id, project.id);

    logger.info(
      { projectId: project.id, promptId: id, success: result.success },
      "Successfully deleted prompt"
    );

    return c.json(result satisfies z.infer<typeof successSchema>);
  }
);
