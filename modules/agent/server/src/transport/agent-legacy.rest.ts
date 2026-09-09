import {
  AgentApi,
  agentRestParamsSchema,
  agentRestQuerySchema,
  agentResponseSchema,
  agentPaginationSchema,
  archiveResultSchema,
  createAgentRequestSchema,
  updateAgentRequestSchema,
  type Agent,
} from "@langwatch/agent-contract";
import { defineRestRouter, MANAGEMENT_API_VERSION, projectRestFacts } from "@langwatch/api/rest";
import { z } from "zod";
import {
  deprecatedAlias,
  mountProjectRestRouter,
  type AppRestSecurity,
  type MountableRestApp,
} from "@langwatch/api/rest";
import { agentRestErrorHandler, type AgentPlatformUrlBuilder } from "./agent.rest.ts";

const legacyResponse = agentResponseSchema.pick({
  id: true,
  name: true,
  type: true,
  config: true,
  createdAt: true,
  updatedAt: true,
  platformUrl: true,
});
const legacyListResponse = z.object({
  data: legacyResponse.array(),
  pagination: agentPaginationSchema,
});

export function createAgentLegacyRouter(platformUrl: AgentPlatformUrlBuilder) {
  const response = (agent: Agent, projectSlug: string) => ({
    id: agent.id,
    name: agent.name,
    type: agent.type,
    config: agent.config,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    platformUrl: platformUrl({ projectSlug, agentId: agent.id, agentType: agent.type }),
  });

  return defineRestRouter(AgentApi)
    .withNamespace("agents")
    .withVersion(MANAGEMENT_API_VERSION)

    .get("/", "listLegacyAgents")
    .withQuery(agentRestQuerySchema)
    .withPermission("project:view")
    .withOutput(legacyListResponse)
    .withDocs({ summary: "List agents; superseded by /api/v1/agents" })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, facts) => {
      const page = await app.list({ ...input, projectId: scope.id });

      return {
        ...page,
        data: page.data.map((agent) => ({
          ...agent,
          platformUrl: platformUrl({
            projectSlug: facts.projectSlug,
            agentId: agent.id,
            agentType: agent.type,
          }),
        })),
      };
    })

    .post("/", "createLegacyAgent")
    .withInput(createAgentRequestSchema)
    .withPermission("project:update")
    .withOutput(legacyResponse)
    .withStatus(201)
    .withDocs({ summary: "Create an agent; superseded by /api/v1/agents" })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, facts) => {
      const agent = await app.create({ ...input, projectId: scope.id });

      return response(agent, facts.projectSlug);
    })

    .get("/:id", "getLegacyAgent")
    .withParams(agentRestParamsSchema)
    .withPermission("project:view")
    .withOutput(legacyResponse)
    .withDocs({ summary: "Get an agent; superseded by /api/v1/agents" })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, facts) =>
      response(await app.getById({ ...input, projectId: scope.id }), facts.projectSlug),
    )

    .patch("/:id", "updateLegacyAgent")
    .withParams(agentRestParamsSchema)
    .withInput(updateAgentRequestSchema)
    .withPermission("project:update")
    .withOutput(legacyResponse)
    .withDocs({ summary: "Update an agent; superseded by /api/v1/agents" })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, facts) =>
      response(await app.update({ ...input, projectId: scope.id }), facts.projectSlug),
    )

    .delete("/:id", "archiveLegacyAgent")
    .withParams(agentRestParamsSchema)
    .withPermission("project:delete")
    .withOutput(archiveResultSchema)
    .withDocs({ summary: "Archive an agent; superseded by /api/v1/agents" })
    .handle(async ({ app, input, scope }) => {
      const agent = await app.archive({ ...input, projectId: scope.id });

      return { id: agent.id, name: agent.name, type: agent.type, archivedAt: agent.archivedAt };
    })
    .build();
}

export const AGENTS_ALIAS_SUCCESSOR = "/api/v1/agents";

export function createAgentLegacyRestApp(options: {
  security: AppRestSecurity;
  agents: () => AgentApi;
  agentPlatformUrl: AgentPlatformUrlBuilder;
}): MountableRestApp {
  const family = options.security.createProjectVersionedApp({
    name: "agents",
    basePath: "/api/agents",
    errorEnvelope: "legacy",
    bareMount: true,
    v1Alias: false,
    routeMiddleware: [
      deprecatedAlias({
        successor: AGENTS_ALIAS_SUCCESSOR,
        notice: `superseded by ${AGENTS_ALIAS_SUCCESSOR}`,
      }),
    ],
    errorHandler: agentRestErrorHandler,
  });
  family.service.withDeprecated(`superseded by ${AGENTS_ALIAS_SUCCESSOR}`);

  mountProjectRestRouter({
    family,
    transport: createAgentLegacyRouter(options.agentPlatformUrl).router(),
    app: options.agents,
  });

  return family.service.build();
}
