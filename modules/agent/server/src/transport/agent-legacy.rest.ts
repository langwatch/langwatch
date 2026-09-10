/**
 * `/api/agents` - the bare-path predecessor of `/api/v1/agents`, kept as a
 * deprecated twin so existing callers keep working. Superseded field set: no
 * presence, no owner, no parameters.
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

function response(agent: Agent, app: AgentApi, projectSlug: string) {
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
  .withDeprecated({ successor: AGENTS_ALIAS_SUCCESSOR, notice: `superseded by ${AGENTS_ALIAS_SUCCESSOR}` })

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
      data: page.data.map((agent) => response(agent, app, facts.projectSlug)),
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

    return response(agent, app, facts.projectSlug);
  })

  .get("/:id", "getLegacyAgent")
  .withParams(agentRestParamsSchema)
  .withPermission("project:view")
  .withOutput(legacyResponse)
  .withDocs({ summary: "Get an agent; superseded by /api/v1/agents" })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) =>
    response(await app.getById({ ...input, projectId: scope.id }), app, facts.projectSlug),
  )

  .patch("/:id", "updateLegacyAgent")
  .withParams(agentRestParamsSchema)
  .withInput(updateAgentRequestSchema)
  .withPermission("project:update")
  .withOutput(legacyResponse)
  .withDocs({ summary: "Update an agent; superseded by /api/v1/agents" })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) =>
    response(await app.update({ ...input, projectId: scope.id }), app, facts.projectSlug),
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
