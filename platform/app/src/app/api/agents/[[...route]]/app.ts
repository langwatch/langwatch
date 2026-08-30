import { describeRoute, resolver } from "hono-openapi";
import { nanoid } from "nanoid";
import { ZodError, z } from "zod";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import {
  type AgentComponentConfig,
  agentTypeSchema,
} from "../../../../server/agents/agent.repository";
import { toAgentListRow } from "../../../../server/agents/agent.service";
import { AgentRegisterOnlyError } from "../../../../server/agents/errors";
import { scenarioParameterDefinitionSchema } from "../../../../server/scenarios/parameters";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import {
  type AgentServiceMiddlewareVariables,
  agentServiceMiddleware,
} from "../../middleware/agent-service";
import { NotFoundError, UnprocessableEntityError } from "../../shared/errors";
import { agentPlatformUrl } from "../agent-platform-url";
import { handleAgentError } from "./error-handler";

patchZodOpenapi();

// -- Validation schemas --

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const createAgentSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
  type: agentTypeSchema,
  config: z.record(z.unknown()),
  workflowId: z.string().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: agentTypeSchema.optional(),
  config: z.record(z.unknown()).optional(),
  workflowId: z.string().nullable().optional(),
});

/**
 * Maps AgentNotFoundError from the service layer to the HTTP NotFoundError.
 */
function mapAgentNotFoundError(error: unknown): never {
  if (error instanceof Error && error.name === "AgentNotFoundError") {
    throw new NotFoundError("Agent not found");
  }
  throw error;
}

/**
 * Maps ZodError from config validation to a 422 UnprocessableEntityError.
 * Config is validated against the agent type's DSL schema in the repository layer.
 */
function mapConfigValidationError(error: unknown): never {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    throw new UnprocessableEntityError(
      issue?.message ?? "Invalid agent config",
    );
  }
  throw error;
}

const secured = createProjectApp<AgentServiceMiddlewareVariables>({
  basePath: "/api/agents",
});

secured.hono.onError(handleAgentError);

// ── List Agents (paginated) ──────────────────────────────────
secured.access(requires("project:view")).get(
  "/",
  agentServiceMiddleware,
  describeRoute({
    description: "List all non-archived agents for the project (paginated)",
  }),
  zValidator("query", paginationQuerySchema),
  async (c) => {
    const project = c.get("project");
    const { page, limit } = c.req.valid("query");
    const service = c.get("agentService");

    const result = await service.listAgents({
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
    description: "Create a new agent",
  }),
  zValidator("json", createAgentSchema),
  async (c) => {
    const project = c.get("project");
    const { name, type, config, workflowId } = c.req.valid("json");
    const service = c.get("agentService");
    // A connected agent is registered by the SDK from the process that runs
    // it; a request body cannot stand in for that process.
    if (type === "connected") throw new AgentRegisterOnlyError();

    let agent;
    try {
      agent = await service.create({
        id: `agent_${nanoid()}`,
        projectId: project.id,
        name,
        type,
        config: config as AgentComponentConfig,
        workflowId,
      });
    } catch (error) {
      return mapConfigValidationError(error);
    }

    return c.json(
      {
        ...toAgentListRow(agent),
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
    description: "Get an agent by its id",
  }),
  async (c) => {
    const { id } = c.req.param();
    const project = c.get("project");
    const service = c.get("agentService");

    let agent;
    try {
      agent = await service.getByIdOrThrow({
        id,
        projectId: project.id,
      });
    } catch (error) {
      return mapAgentNotFoundError(error);
    }

    return c.json({
      ...toAgentListRow(agent),
      platformUrl: agentPlatformUrl({
        projectSlug: project.slug,
        agentId: agent.id,
        agentType: agent.type,
      }),
    });
  },
);

const agentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: agentTypeSchema.describe(
    "The kind of agent. A connected agent is registered from code by the SDK and cannot be created or reconfigured through this API.",
  ),
  config: z.record(z.unknown()).nullable(),
  environment: z
    .string()
    .nullable()
    .describe(
      "The environment a connected agent registered with, for example production or development. Null for every other kind.",
    ),
  ownerUserId: z
    .string()
    .nullable()
    .describe(
      "The user a personal development agent belongs to. Only that user can run simulations against it. Null when the agent is shared.",
    ),
  hostLabel: z
    .string()
    .nullable()
    .describe(
      "The machine a development agent registered from with a project or service key. Null when the agent is personal or shared.",
    ),
  lastSeenAt: z
    .date()
    .nullable()
    .describe(
      "When an instance of a connected agent was last connected. Null for every other kind.",
    ),
  parameters: z
    .array(scenarioParameterDefinitionSchema)
    .describe(
      "The run parameters a connected agent declares from its function signature: name, type, options, default and description. Empty for every other kind.",
    ),
  createdAt: z.date(),
  updatedAt: z.date(),
  platformUrl: z.string().url(),
});

const agentErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

// ── Update Agent ─────────────────────────────────────────────
// Registered under both verbs. The update is partial either way, so a caller
// reaching for the other verb should get the same behavior instead of a 404.
for (const verb of ["patch", "put"] as const) {
  registerUpdateAgentVerb(verb);
}

function registerUpdateAgentVerb(verb: "patch" | "put"): void {
  secured.access(requires("project:update"))[verb](
    "/:id",
    agentServiceMiddleware,
    describeRoute({
      description: "Update an agent by its id",
      responses: {
        200: {
          description: "Agent updated",
          content: {
            "application/json": { schema: resolver(agentResponseSchema) },
          },
        },
        404: {
          description: "Agent not found in this project",
          content: {
            "application/json": { schema: resolver(agentErrorSchema) },
          },
        },
        422: {
          description: "The request body does not match the expected shape",
          content: {
            "application/json": { schema: resolver(agentErrorSchema) },
          },
        },
      },
    }),
    zValidator("json", updateAgentSchema),
    async (c) => {
      const { id } = c.req.param();
      const project = c.get("project");
      const body = c.req.valid("json");
      const service = c.get("agentService");

      let agent;
      try {
        agent = await service.updateOrThrow({
          id,
          projectId: project.id,
          data: {
            ...(body.name && { name: body.name }),
            ...(body.type && { type: body.type }),
            ...(body.config && { config: body.config as AgentComponentConfig }),
            ...(body.workflowId !== undefined && {
              workflowId: body.workflowId,
            }),
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AgentNotFoundError") {
          throw new NotFoundError("Agent not found");
        }
        return mapConfigValidationError(error);
      }

      return c.json({
        ...toAgentListRow(agent),
        platformUrl: agentPlatformUrl({
          projectSlug: project.slug,
          agentId: agent.id,
          agentType: agent.type,
        }),
      });
    },
  );
}

// ── Delete (Archive) Agent ───────────────────────────────────
secured.access(requires("project:delete")).delete(
  "/:id",
  agentServiceMiddleware,
  describeRoute({
    description: "Archive an agent (soft-delete)",
  }),
  async (c) => {
    const { id } = c.req.param();
    const project = c.get("project");
    const service = c.get("agentService");

    try {
      const agent = await service.archiveAgent({
        id,
        projectId: project.id,
      });
      return c.json({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        archivedAt: agent.archivedAt,
      });
    } catch (error) {
      return mapAgentNotFoundError(error);
    }
  },
);

export const app = secured.hono;
