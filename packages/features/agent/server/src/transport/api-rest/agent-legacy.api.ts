import {
  agentIdPathSchema,
  agentListViewSchema,
  agentViewWithPlatformUrlSchema,
  AgentNotFoundError,
  archivedAgentViewSchema,
  createAgentRequestSchema,
  InvalidAgentConfigError,
  listAgentsQuerySchema,
  updateAgentRequestSchema,
} from "@langwatch/agent-contract";
import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  createFamilyErrorHandler,
  NotFoundError,
  type SecuredApp,
  UnprocessableEntityError,
  validator as zValidator,
} from "@langwatch/api/rest";
import type { ErrorHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import { AgentApp } from "#app/agent.app";

/**
 * The platform's own address for ONE agent: the agents page with the editor
 * drawer for that agent open.
 *
 * A port because the drawer the address opens is the application's own routing
 * vocabulary, shared with the Langy navigate fallback, and the origin comes
 * from the deployment's validated environment.
 */
export type AgentPlatformUrlBuilder = (args: {
  projectSlug: string;
  agentId: string;
  agentType: string;
}) => string;

/**
 * The deprecated `/api/agents` REST family.
 *
 * Every route is marked `deprecated` and tagged `Legacy` in the published
 * document; the surface remains mounted because deployed callers still use it.
 */
export function createAgentLegacyRestApp(options: {
  security: AppRestSecurity;
  /**
   * The feature's application, as a provider: mounting the family must not
   * force its services to be constructed, which is what lets the OpenAPI
   * generator and the route-registry audits build it without a live process.
   */
  agents: () => AgentApp;
  agentPlatformUrl: AgentPlatformUrlBuilder;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, agents, agentPlatformUrl } = options;

  const secured = security.createProjectApp({ basePath: "/api/agents" });

  const boundary = createFamilyErrorHandler({
    loggerName: "langwatch:api:agents:errors",
    label: "Agent API Error",
    boundary: security.legacyErrorHandler,
  });

  /**
   * The family's two domain failures, mapped onto the status-carrying classes
   * the shared handler renders. Everything else reaches the boundary with its
   * own code, meta and remediation intact.
   */
  const handleAgentError: ErrorHandler = (error, c) => {
    if (error instanceof AgentNotFoundError) {
      return boundary(new NotFoundError(error.message), c);
    }
    if (error instanceof InvalidAgentConfigError) {
      return boundary(new UnprocessableEntityError(error.message), c);
    }
    return boundary(error, c);
  };

  secured.hono.onError(handleAgentError);

  // ── List Agents (paginated) ──────────────────────────────────
  secured.access(requires("project:view")).get(
    "/",
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

      const result = await agents().list({
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

      const agent = await agents().create({
        ...body,
        id: AgentApp.nextAgentId(),
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

      const agent = await agents().getById({
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

      const agent = await agents().update({
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

      const agent = await agents().archive({
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

  return secured;
}
