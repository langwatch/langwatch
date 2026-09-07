import { nextAgentId } from "#rules/agent-id.rules";
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
  type Agent,
} from "@langwatch/agent-contract";
import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  createFamilyErrorHandler,
  deprecatedAlias,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  NotFoundError,
  projectOf,
  type ProjectScopedContext,
  resolver,
  UnprocessableEntityError,
} from "@langwatch/api/rest";
import type { ErrorHandler } from "hono";
import { z } from "zod";

import { AgentApp } from "#app/agent.app";

/**
 * The platform's own address for ONE agent: the agents page with the editor drawer for
 * that agent open.
 */
export type AgentPlatformUrlBuilder = (args: {
  projectSlug: string;
  agentId: string;
  agentType: string;
}) => string;

/** The family that supersedes this one, named on every answer. */
export const AGENTS_ALIAS_SUCCESSOR = "/api/v1/agents";

/** The notice every answer on this family carries. */
const DEPRECATION_NOTICE = `superseded by ${AGENTS_ALIAS_SUCCESSOR}`;

const listAgentsRestQuerySchema = listAgentsQuerySchema.omit({ projectId: true });

/**
 * The deprecated `/api/agents` REST family.
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
}): MountableRestApp {
  const { security, agents, agentPlatformUrl } = options;

  /**
   * The family's two domain failures, mapped onto the status-carrying classes
   * the shared handler renders. Everything else reaches the boundary with its
   * own code, meta and remediation intact.
   */
  const agentErrorHandler = (spine: ErrorHandler): ErrorHandler => {
    const boundary = createFamilyErrorHandler({
      loggerName: "langwatch:api:agents:errors",
      label: "Agent API Error",
      boundary: spine,
    });
    return (error, c) => {
      if (error instanceof AgentNotFoundError) {
        return boundary(new NotFoundError(error.message), c);
      }
      if (error instanceof InvalidAgentConfigError) {
        return boundary(new UnprocessableEntityError(error.message), c);
      }
      return boundary(error, c);
    };
  };

  // No derived twin: `/api/v1/agents` is the family that supersedes this one.
  const { service, policy } = security.createProjectVersionedApp({
    name: "agents",
    basePath: "/api/agents",
    errorEnvelope: "legacy",
    errorHandler: agentErrorHandler,
    // The bare paths alone: `/api/v1/agents` is the family that supersedes
    // this one, so this family publishes no version namespace of its own.
    bareMount: true,
    // No derived twin (see above): the successor family already answers
    // literally at `/api/v1/agents`, so this legacy family must not also
    // claim it via the automatic bare-mount alias.
    v1Alias: false,
    // Every answer names the successor, refusals included: an integrator
    // reading the wire finds the move without reading the docs.
    routeMiddleware: [deprecatedAlias({ successor: AGENTS_ALIAS_SUCCESSOR })],
  });

  type AgentContext = ProjectScopedContext<EndpointVariables>;

  /** One agent as this family publishes it, with its platform address. */
  const agentView = (
    agent: {
      id: string;
      name: string;
      type: string;
      config: unknown;
      createdAt: Agent["createdAt"];
      updatedAt: Agent["updatedAt"];
    },
    projectSlug: string,
  ) => ({
    id: agent.id,
    name: agent.name,
    type: agent.type,
    config: agent.config,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    platformUrl: agentPlatformUrl({ projectSlug, agentId: agent.id, agentType: agent.type }),
  });

  const listHandler = async (c: AgentContext, input: z.infer<typeof listAgentsRestQuerySchema>) => {
    const project = projectOf(c);
    const result = await agents().list({
      projectId: project.id,
      page: input.page,
      limit: input.limit,
    });

    return {
      ...result,
      data: result.data.map((a: { id: string; type: string }) => ({
        ...a,
        platformUrl: agentPlatformUrl({
          projectSlug: project.slug,
          agentId: a.id,
          agentType: a.type,
        }),
      })),
    };
  };

  const createHandler = async (
    c: AgentContext,
    input: z.infer<typeof createAgentRequestSchema>,
  ) => {
    const project = projectOf(c);
    const agent = await agents().create({
      ...input,
      id: nextAgentId(),
      projectId: project.id,
    });
    return agentView(agent, project.slug);
  };

  const getHandler = async (c: AgentContext, input: z.infer<typeof agentIdPathSchema>) => {
    const project = projectOf(c);
    const agent = await agents().getById({ id: input.id, projectId: project.id });
    return agentView(agent, project.slug);
  };

  const updateHandler = async (
    c: AgentContext,
    input: z.infer<typeof agentIdPathSchema> & z.infer<typeof updateAgentRequestSchema>,
  ) => {
    const project = projectOf(c);
    const { id, ...body } = input;
    const agent = await agents().update({ ...body, id, projectId: project.id });
    return agentView(agent, project.slug);
  };

  const archiveHandler = async (c: AgentContext, input: z.infer<typeof agentIdPathSchema>) => {
    const agent = await agents().archive({ id: input.id, projectId: projectOf(c).id });
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      archivedAt: agent.archivedAt,
    };
  };

  return (
    service
      // ── List Agents (paginated) ──────────────────────────────────
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(requires("project:view"))(b)
          .withQuery(listAgentsRestQuerySchema)
          .withOutput(agentListViewSchema)
          .withDeprecated(DEPRECATION_NOTICE)
          .withDocs({
            tags: ["Legacy"],
            description: "List all non-archived agents for the project (paginated)",
            responses: {
              200: {
                description: "Agents page",
                content: { "application/json": { schema: resolver(agentListViewSchema) } },
              },
            },
          }),
      )
      // ── Create Agent ─────────────────────────────────────────────
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(requires("project:update"))(b)
          .withInput(createAgentRequestSchema)
          .withOutput(agentViewWithPlatformUrlSchema)
          .withStatus(201)
          .withDeprecated(DEPRECATION_NOTICE)
          .withDocs({
            tags: ["Legacy"],
            description: "Create a new agent",
            responses: {
              201: {
                description: "Agent created",
                content: {
                  "application/json": { schema: resolver(agentViewWithPlatformUrlSchema) },
                },
              },
            },
          }),
      )
      // ── Get Single Agent ─────────────────────────────────────────
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requires("project:view"))(b)
          .withParams(agentIdPathSchema)
          .withOutput(agentViewWithPlatformUrlSchema)
          .withDeprecated(DEPRECATION_NOTICE)
          .withDocs({
            tags: ["Legacy"],
            description: "Get an agent by its id",
            responses: {
              200: {
                description: "Agent",
                content: {
                  "application/json": { schema: resolver(agentViewWithPlatformUrlSchema) },
                },
              },
            },
          }),
      )
      // ── Update Agent ─────────────────────────────────────────────
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy(requires("project:update"))(b)
          .withParams(agentIdPathSchema)
          .withInput(updateAgentRequestSchema)
          .withOutput(agentViewWithPlatformUrlSchema)
          .withDeprecated(DEPRECATION_NOTICE)
          .withDocs({
            tags: ["Legacy"],
            description: "Update an agent by its id",
            responses: {
              200: {
                description: "Agent updated",
                content: {
                  "application/json": { schema: resolver(agentViewWithPlatformUrlSchema) },
                },
              },
            },
          }),
      )
      // ── Delete (Archive) Agent ───────────────────────────────────
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
        policy(requires("project:delete"))(b)
          .withParams(agentIdPathSchema)
          .withOutput(archivedAgentViewSchema)
          .withDeprecated(DEPRECATION_NOTICE)
          .withDocs({
            tags: ["Legacy"],
            description: "Archive an agent (soft-delete)",
            responses: {
              200: {
                description: "Agent archived",
                content: { "application/json": { schema: resolver(archivedAgentViewSchema) } },
              },
            },
          }),
      )
      .build()
  );
}
