import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { describeRoute } from "hono-openapi";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import { appRouter } from "../../../../server/api/root";
import { prisma } from "../../../../server/db";
import type { Project } from "@prisma/client";

patchZodOpenapi();

// Reuse schema definitions
const configJsonSchema = z.record(z.any());
const baseConfigSchema = z.object({
  name: z.string().min(1, "Name cannot be empty."),
});
const baseVersionSchema = z.object({
  configData: configJsonSchema,
  schemaVersion: z.string().min(1, "Schema version cannot be empty."),
  commitMessage: z.string().optional(),
});

// Define types for our Hono context variables
type Variables = {
  project: Project;
  caller: ReturnType<typeof appRouter.createCaller>;
};

export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/llmConfigs");

// Create TRPC caller with project context
const createCaller = () => {
  return appRouter.createCaller({
    prisma,
    session: null,
    req: undefined,
    res: undefined,
    permissionChecked: true, // Skip permission check since we do our own
    publiclyShared: false,
  });
};

// Unified auth middleware that validates API key and project ID
app.use("/project/:projectId/*", async (c, next) => {
  const { projectId } = c.req.param();
  const apiKey =
    c.req.header("X-Auth-Token") ??
    c.req.header("Authorization")?.split(" ")[1];

  if (!apiKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey },
  });

  if (!project || project.id !== projectId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Store project and caller for use in route handlers
  c.set("project", project);
  c.set("caller", createCaller());

  return next();
});

// Get all configs
app.get(
  "/project/:projectId/configs",
  describeRoute({
    description: "Get all LLM configs for a project",
  }),
  async (c) => {
    const caller = c.get("caller");
    const { projectId } = c.req.param();

    const configs = await caller.llmConfigs.getPromptConfigs({ projectId });
    return c.json(configs);
  }
);

// Get config by ID
app.get(
  "/project/:projectId/configs/:id",
  describeRoute({
    description: "Get a specific LLM config",
  }),
  async (c) => {
    const caller = c.get("caller");
    const { id, projectId } = c.req.param();

    try {
      const config = await caller.llmConfigs.getPromptConfigById({
        id,
        projectId,
      });
      return c.json(config);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);

// Create config
app.post(
  "/project/:projectId/configs",
  describeRoute({
    description: "Create a new LLM config",
  }),
  zValidator("json", baseConfigSchema.merge(baseVersionSchema)),
  async (c) => {
    const caller = c.get("caller");
    const { projectId } = c.req.param();
    const data = c.req.valid("json");

    const newConfig = await caller.llmConfigs.createPromptConfig({
      ...data,
      projectId,
    });

    return c.json(newConfig);
  }
);

// Get versions
app.get(
  "/project/:projectId/configs/:configId/versions",
  describeRoute({
    description: "Get all versions for an LLM config",
  }),
  async (c) => {
    const caller = c.get("caller");
    const { configId, projectId } = c.req.param();

    try {
      const versions = await caller.llmConfigs.versions.getVersions({
        configId,
        projectId,
      });
      return c.json(versions);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);

// Create version
app.post(
  "/project/:projectId/configs/:configId/versions",
  describeRoute({
    description: "Create a new version for an LLM config",
  }),
  zValidator("json", baseVersionSchema),
  async (c) => {
    const caller = c.get("caller");
    const { configId, projectId } = c.req.param();
    const data = c.req.valid("json");

    try {
      const version = await caller.llmConfigs.versions.create({
        ...data,
        configId,
        projectId,
      });
      return c.json(version);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);

// Update config
app.put(
  "/project/:projectId/configs/:id",
  describeRoute({
    description: "Update an LLM config",
  }),
  zValidator("json", baseConfigSchema.partial()),
  async (c) => {
    const caller = c.get("caller");
    const { id, projectId } = c.req.param();
    const data = c.req.valid("json");

    try {
      const updatedConfig = await caller.llmConfigs.updatePromptConfig({
        ...data,
        id,
        projectId,
      });
      return c.json(updatedConfig);
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);

// Delete config
app.delete(
  "/project/:projectId/configs/:id",
  describeRoute({
    description: "Delete an LLM config",
  }),
  async (c) => {
    const caller = c.get("caller");
    const { id, projectId } = c.req.param();

    try {
      await caller.llmConfigs.deletePromptConfig({ id, projectId });
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  }
);
