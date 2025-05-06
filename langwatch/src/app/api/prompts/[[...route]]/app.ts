import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { LlmConfigRepository } from "~/server/prompt-config/repositories/llm-config.repository";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger";
import { loggerMiddleware } from "../../hono-middleware/logger";
import {
  badRequestSchema,
  llmPromptConfigSchema,
  promptOutputSchema,
  successSchema,
  versionInputSchema,
  versionOutputSchema,
} from "./schemas";
import { authMiddleware } from "./middleware/auth";
import { getOutputsToResponseFormat } from "./utils";
import { baseResponses } from "./constants";

const logger = createLogger("langwatch:api:prompts");

patchZodOpenapi();

// Define types for our Hono context variables
type Variables = {
  project: Project;
  llmConfigRepository: LlmConfigRepository;
};

export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/prompts");
app.use(loggerMiddleware());
app.use("/*", authMiddleware);

// Get all prompts
app.get(
  "/",
  describeRoute({
    description: "Get all prompts for a project",
    responses: {
      ...baseResponses,
      200: {
        content: {
          "application/json": { schema: z.array(promptOutputSchema) },
        },
      },
    },
  }),
  async (c) => {
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const configs = await repository.getAllWithLatestVersion(project.id);
    return c.json(configs);
  }
);

// Get prompt by ID
app.get(
  "/:id",
  describeRoute({
    description: "Get a specific prompt",
    responses: {
      ...baseResponses,
      200: {
        content: {
          "application/json": { schema: promptOutputSchema },
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
      "Getting prompt by ID"
    );

    try {
      const config = await repository.getConfigByIdWithLatestVersions(
        id,
        project.id
      );

      const response = {
        id,
        name: config.name,
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
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
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
      200: {
        content: {
          "application/json": { schema: promptOutputSchema },
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
    const data = c.req.valid("json");
    const { name } = data;

    const newConfig = await repository.createConfigWithInitialVersion({
      name,
      projectId: project.id,
    });

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
      200: {
        content: {
          "application/json": { schema: z.array(promptOutputSchema) },
        },
      },
    },
  }),
  async (c) => {
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const { id } = c.req.param();

    try {
      const versions = await repository.versions.getVersionsForConfigById({
        configId: id,
        projectId: project.id,
      });
      return c.json(versions);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);

// Create version
app.post(
  "/:id/versions",
  describeRoute({
    description: "Create a new version for a prompt",
    responses: {
      ...baseResponses,
      200: {
        content: {
          "application/json": { schema: versionOutputSchema },
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

    try {
      const version = await repository.versions.createVersion({
        ...data,
        configId: id,
        projectId: project.id,
      });
      return c.json(version);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);

// Update prompt
app.put(
  "/:id",
  describeRoute({
    description: "Update a prompt",
    responses: {
      ...baseResponses,
      200: {
        content: {
          "application/json": { schema: llmPromptConfigSchema },
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

    try {
      const updatedConfig = await repository.updateConfig(id, project.id, data);
      return c.json(updatedConfig);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
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
      200: {
        content: {
          "application/json": { schema: successSchema },
        },
      },
    },
  }),
  async (c) => {
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const { id } = c.req.param();

    try {
      const result = await repository.deleteConfig(id, project.id);
      return c.json(result satisfies z.infer<typeof successSchema>);
    } catch (error: any) {
      return c.json(
        { error: error.message } satisfies z.infer<typeof badRequestSchema>,
        404
      );
    }
  }
);
