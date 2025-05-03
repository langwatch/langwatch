import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import {
  getLatestConfigVersionSchema,
  schemaValidators,
  SchemaVersion,
} from "~/server/prompt-config/repositories/llm-config-version-schema";
import { prisma } from "~/server/db";
import {
  LlmConfigRepository,
  type LlmConfigWithLatestVersion,
} from "~/server/prompt-config/repositories/llm-config.repository";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger";
import { loggerMiddleware } from "../../hono-middleware/logger";
import type { LlmConfigOutputType } from "../../../../types";

const logger = createLogger("langwatch:api:prompts");

patchZodOpenapi();

// Reuse schema definitions
const baseConfigSchema = z.object({
  name: z.string().min(1, "Name cannot be empty."),
});

// Define types for our Hono context variables
type Variables = {
  project: Project;
  llmConfigRepository: LlmConfigRepository;
};

export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/prompts");
app.use(loggerMiddleware());

// Auth middleware that validates API key and extracts project
app.use("/*", async (c, next) => {
  const apiKey =
    c.req.header("X-Auth-Token") ??
    c.req.header("Authorization")?.split(" ")[1];

  const project = await prisma.project.findUnique({
    where: { apiKey },
  });

  if (!project || apiKey !== project.apiKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Store project and repository for use in route handlers
  c.set("project", project);
  c.set("llmConfigRepository", new LlmConfigRepository(prisma));

  return next();
});

// Get all prompts
app.get(
  "/",
  describeRoute({
    description: "Get all prompts for a project",
  }),
  async (c) => {
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");

    const configs = await repository.getAllWithLatestVersion(project.id);
    return c.json(configs);
  }
);

const responseFormatSchema = z.object({
  type: z.enum(["json_schema"]),
  json_schema: z.object({
    name: z.string(),
    schema: z.object({}),
  }),
});

const promptOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number(),
  versionId: z.string(),
  versionCreatedAt: z.date(),
  model: z.string(),
  prompt: z.string(),
  messages: z.array(
    z
      .object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      })
      .passthrough()
  ),
  response_format: responseFormatSchema.optional(),
});

// Get prompt by ID
app.get(
  "/:id",
  describeRoute({
    description: "Get a specific prompt",
    responses: {
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

      let outputsToResponseFormat = undefined;

      const response = {
        id,
        name: config.name,
        version: config.latestVersion.version,
        versionId: config.latestVersion.id ?? "",
        versionCreatedAt: config.latestVersion.createdAt ?? new Date(),
        model: config.latestVersion.configData.model,
        prompt: config.latestVersion.configData.prompt,
        messages: [
          {
            role: "system",
            content: config.latestVersion.configData.prompt,
          },
        ],
        response_format: getOutputsToResponseFormat(config),
      } satisfies z.infer<typeof promptOutputSchema>;
      return c.json(response);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);

const llmOutputFieldToJsonSchemaTypeMap: Record<LlmConfigOutputType, string> = {
  str: "string",
  float: "number",
  bool: "boolean",
  json_schema: "object",
};

const getOutputsToResponseFormat = (
  config: LlmConfigWithLatestVersion
): z.infer<typeof responseFormatSchema> | undefined => {
  const outputs = config.latestVersion.configData.outputs;
  if (!outputs.length || (outputs.length === 1 && outputs[0]?.type === "str")) {
    return undefined;
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "outputs",
      schema: {
        type: "object",
        properties: Object.fromEntries(
          outputs.map((output) => {
            if (output.type === "json_schema") {
              return [
                output.identifier,
                output.json_schema ?? { type: "object", properties: {} },
              ];
            }
            return [
              output.identifier,
              {
                type: llmOutputFieldToJsonSchemaTypeMap[output.type],
              },
            ];
          })
        ),
        required: outputs.map((output) => output.identifier),
      },
    },
  };
};

// Create prompt with initial version
// TODO: Consider allowing for the initial version to be customized via params
app.post(
  "/",
  describeRoute({
    description: "Create a new prompt with default initial version",
  }),
  zValidator("json", baseConfigSchema),
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
  }),
  zValidator("json", getLatestConfigVersionSchema()),
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
  }),
  zValidator("json", baseConfigSchema.partial()),
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
  }),
  async (c) => {
    const repository = c.get("llmConfigRepository");
    const project = c.get("project");
    const { id } = c.req.param();

    try {
      const result = await repository.deleteConfig(id, project.id);
      return c.json(result);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);
