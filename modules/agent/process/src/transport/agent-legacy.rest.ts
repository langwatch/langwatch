/**
 * `/api/agents` - the bare-path predecessor of `/api/v1/agents`, a deprecated
 * twin so existing callers keep working: no presence, no owner, no parameters,
 * and hidden from the document, since these are the successor's own operations.
 */
import {
  AgentApi,
  agentPaginationSchema,
  agentRestParamsSchema,
  agentRestQuerySchema,
  agentResponseSchema,
  archiveResultSchema,
  createAgentRequestSchema,
  updateAgentRequestSchema,
  type Agent,
} from "@langwatch/agent-contract";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { z } from "zod";

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

function response(
  agent: Agent,
  app: AgentApi,
  projectSlug: string,
): {
  id: string;
  name: string;
  type: Agent["type"];
  config: Agent["config"];
  createdAt: Date;
  updatedAt: Date;
  platformUrl: string;
} {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    config: agent.config,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    platformUrl: app.platformUrl({ projectSlug, agentId: agent.id, agentType: agent.type }),
  };
}

export const AGENTS_ALIAS_SUCCESSOR = "/api/v1/agents";

export const agentLegacyRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AgentApi>;
}> = defineRestRouter(AgentApi)
  .withNamespace("agents")
  .withVersion(MANAGEMENT_API_VERSION)
  // The bare path was never aliased: `/api/v1/agents` is the SUCCESSOR family,
  // not this one's twin, so claiming the twin would publish two declarations at
  // one address.
  .withAddressing("dated", { v1Twin: false })
  .withDeprecated({
    successor: AGENTS_ALIAS_SUCCESSOR,
    notice: `superseded by ${AGENTS_ALIAS_SUCCESSOR}`,
  })

  .get("/", "listAgents")
  .withQuery(agentRestQuerySchema)
  .withPermission("project:view")
  .withOutput(legacyListResponse)
  .withDocs({ summary: "List agents; superseded by /api/v1/agents", hide: true })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) => {
    const page = await app.list({ ...input, projectId: scope.id });

    return {
      ...page,
      data: page.data.map((agent) => response(agent, app, facts.projectSlug)),
    };
  })

  .post("/", "createAgent")
  .withInput(createAgentRequestSchema)
  .withPermission("project:update")
  .withOutput(legacyResponse)
  .withStatus(201)
  .withDocs({ summary: "Create an agent; superseded by /api/v1/agents", hide: true })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) => {
    const agent = await app.create({ ...input, projectId: scope.id });

    return response(agent, app, facts.projectSlug);
  })

  .get("/:agentId", "getAgent")
  .withParams(agentRestParamsSchema)
  .withPermission("project:view")
  .withOutput(legacyResponse)
  .withDocs({ summary: "Get an agent; superseded by /api/v1/agents", hide: true })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) =>
    response(
      await app.getById({ ...input, id: input.agentId, projectId: scope.id }),
      app,
      facts.projectSlug,
    ),
  )

  .patch("/:agentId", "updateAgent")
  .withParams(agentRestParamsSchema)
  .withInput(updateAgentRequestSchema)
  .withPermission("project:update")
  .withOutput(legacyResponse)
  .withDocs({ summary: "Update an agent; superseded by /api/v1/agents", hide: true })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) =>
    response(
      await app.update({ ...input, id: input.agentId, projectId: scope.id }),
      app,
      facts.projectSlug,
    ),
  )

  .delete("/:agentId", "archiveAgent")
  .withParams(agentRestParamsSchema)
  .withPermission("project:delete")
  .withOutput(archiveResultSchema)
  .withDocs({ summary: "Archive an agent; superseded by /api/v1/agents", hide: true })
  .handle(async ({ app, input, scope }) => {
    const agent = await app.archive({ ...input, id: input.agentId, projectId: scope.id });

    return { id: agent.id, name: agent.name, type: agent.type, archivedAt: agent.archivedAt };
  })

  .build();
