import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  type AgentComponentConfig,
  agentTypeSchema,
} from "../../../../server/agents/agent.repository";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import {
  type AuthMiddlewareVariables,
  authMiddleware,
  resourceLimitMiddleware,
} from "../../middleware";
import {
  type AgentServiceMiddlewareVariables,
  agentServiceMiddleware,
} from "../../middleware/agent-service";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { NotFoundError, UnprocessableEntityError } from "../../shared/errors";
import { ZodError } from "zod";
import { handleAgentError } from "./error-handler";

patchZodOpenapi();

type Variables = AuthMiddlewareVariables & AgentServiceMiddlewareVariables;

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
 * Validation hook that returns 422 instead of the default 400 for Zod validation errors.
 */
function validationHook(
  result: { success: boolean; error?: { issues: Array<{ message?: string; path?: (string | number)[] }> } },
  c: { json: (body: unknown, status: number) => Response },
): Response | undefined {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    return c.json(
      {
        error: "Unprocessable Entity",
        message: issue?.message ?? "Validation failed",
        path: issue?.path,
      },
      422,
    );
  }
  return undefined;
}

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

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/agents")
  .use(tracerMiddleware({ name: "agents" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .use(agentServiceMiddleware)
  .onError(handleAgentError)

  // ── List Agents (paginated) ──────────────────────────────────
  .get(
    "/",
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

      return c.json(result);
    },
  )

  // ── Create Agent ─────────────────────────────────────────────
  .post(
    "/",
    describeRoute({
      description: "Create a new agent",
    }),
    resourceLimitMiddleware("agents"),
    zValidator("json", createAgentSchema, validationHook),
    async (c) => {
      const project = c.get("project");
      const { name, type, config, workflowId } = c.req.valid("json");
      const service = c.get("agentService");

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
          id: agent.id,
          name: agent.name,
          type: agent.type,
          config: agent.config,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
        },
        201,
      );
    },
  )

  // ── Get Single Agent ─────────────────────────────────────────
  .get(
    "/:id",
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
        id: agent.id,
        name: agent.name,
        type: agent.type,
        config: agent.config,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      });
    },
  )

  // ── Update Agent ─────────────────────────────────────────────
  .patch(
    "/:id",
    describeRoute({
      description: "Update an agent by its id",
    }),
    zValidator("json", updateAgentSchema, validationHook),
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
        id: agent.id,
        name: agent.name,
        type: agent.type,
        config: agent.config,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      });
    },
  )

  // ── Delete (Archive) Agent ───────────────────────────────────
  .delete(
    "/:id",
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
