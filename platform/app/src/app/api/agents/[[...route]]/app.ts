import {
  agentIdPathSchema,
  agentListViewSchema,
  agentViewWithPlatformUrlSchema,
  archivedAgentViewSchema,
  createAgentRequestSchema,
  listAgentsQuerySchema,
  updateAgentRequestSchema,
} from "@langwatch/agent-contract";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi";
import { nanoid } from "nanoid";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import {
  type AgentServiceMiddlewareVariables,
  agentServiceMiddleware,
} from "../../middleware/agent-service";
import { agentPlatformUrl } from "../agent-platform-url";
import { handleAgentError } from "./error-handler";

patchZodOpenapi();

// -- Validation schemas --

const secured = createProjectApp<AgentServiceMiddlewareVariables>({
  basePath: "/api/agents",
});

secured.hono.onError(handleAgentError);

// ── List Agents (paginated) ──────────────────────────────────
secured.access(requires("project:view")).get(
  "/",
  agentServiceMiddleware,
  describeRoute({
    deprecated: true,
    tags: ["Legacy"],
    description: "List all non-archived agents for the project (paginated)",
    responses: {
      200: {
        description: "Agents page",
        content: {
          "application/json": { schema: resolver(agentListViewSchema) },
        },
      },
    },
  }),
  zValidator("query", listAgentsQuerySchema.omit({ projectId: true })),
  async (c) => {
    const project = c.get("project");
    const { page, limit } = c.req.valid("query");
    const service = c.get("agentService");

    const result = await service.list({
      projectId: project.id,
      page,
      limit,
    });

    return c.json({
      ...result,
      data: result.data.map((a: { id: string; type: string }) => ({
        ...a,
        platformUrl: agentPlatformUrl({
          projectSlug: project.slug,
          agentId: a.id,
          agentType: a.type,
        }),
      })),
    });
  },
);

// ── Create Agent ─────────────────────────────────────────────
secured.access(requires("project:update")).post(
  "/",
  agentServiceMiddleware,
  describeRoute({
    deprecated: true,
    tags: ["Legacy"],
    description: "Create a new agent",
    responses: {
      201: {
        description: "Agent created",
        content: {
          "application/json": {
            schema: resolver(agentViewWithPlatformUrlSchema),
          },
        },
      },
    },
  }),
  zValidator("json", createAgentRequestSchema),
  async (c) => {
    const project = c.get("project");
    const body = c.req.valid("json");
    const service = c.get("agentService");

    const agent = await service.create({
      ...body,
      id: `agent_${nanoid()}`,
      projectId: project.id,
    });

    return c.json(
      {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        config: agent.config,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        platformUrl: agentPlatformUrl({
          projectSlug: project.slug,
          agentId: agent.id,
          agentType: agent.type,
        }),
      },
      201,
    );
  },
);

// ── Get Single Agent ─────────────────────────────────────────
secured.access(requires("project:view")).get(
  "/:id",
  agentServiceMiddleware,
  describeRoute({
    deprecated: true,
    tags: ["Legacy"],
    description: "Get an agent by its id",
    responses: {
      200: {
        description: "Agent",
        content: {
          "application/json": {
            schema: resolver(agentViewWithPlatformUrlSchema),
          },
        },
      },
    },
  }),
  zValidator("param", agentIdPathSchema),
  async (c) => {
    const { id } = c.req.param();
    const project = c.get("project");
    const service = c.get("agentService");

    const agent = await service.get({
      id,
      projectId: project.id,
    });

    return c.json({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      config: agent.config,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      platformUrl: agentPlatformUrl({
        projectSlug: project.slug,
        agentId: agent.id,
        agentType: agent.type,
      }),
    });
  },
);

// ── Update Agent ─────────────────────────────────────────────
secured.access(requires("project:update")).patch(
  "/:id",
  agentServiceMiddleware,
  describeRoute({
    deprecated: true,
    tags: ["Legacy"],
    description: "Update an agent by its id",
    responses: {
      200: {
        description: "Agent updated",
        content: {
          "application/json": {
            schema: resolver(agentViewWithPlatformUrlSchema),
          },
        },
      },
    },
  }),
  zValidator("param", agentIdPathSchema),
  zValidator("json", updateAgentRequestSchema),
  async (c) => {
    const { id } = c.req.param();
    const project = c.get("project");
    const body = c.req.valid("json");
    const service = c.get("agentService");

    const agent = await service.update({
      ...body,
      id,
      projectId: project.id,
    });

    return c.json({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      config: agent.config,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      platformUrl: agentPlatformUrl({
        projectSlug: project.slug,
        agentId: agent.id,
        agentType: agent.type,
      }),
    });
  },
);

// ── Delete (Archive) Agent ───────────────────────────────────
secured.access(requires("project:delete")).delete(
  "/:id",
  agentServiceMiddleware,
  describeRoute({
    deprecated: true,
    tags: ["Legacy"],
    description: "Archive an agent (soft-delete)",
    responses: {
      200: {
        description: "Agent archived",
        content: {
          "application/json": { schema: resolver(archivedAgentViewSchema) },
        },
      },
    },
  }),
  zValidator("param", agentIdPathSchema),
  async (c) => {
    const { id } = c.req.param();
    const project = c.get("project");
    const service = c.get("agentService");

    const agent = await service.archive({
      id,
      projectId: project.id,
    });
    return c.json({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      archivedAt: agent.archivedAt,
    });
  },
);

export const app = secured.hono;
