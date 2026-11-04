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
  projectRequestContext,
} from "@langwatch/api/rest";
import { z } from "zod";

import { agentConfigWithoutSecrets } from "../rules/agent-secrets.rules.ts";
import { agentCallerOf } from "../rules/agent-version-caller.rules.ts";

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
): z.infer<typeof legacyResponse> {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    config: agentConfigWithoutSecrets(agent),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    platformUrl: app.platformUrl({ projectSlug, agentId: agent.id, agentType: agent.type }),
  };
}

export const AGENTS_ALIAS_SUCCESSOR = "/api/v1/agents";

export const agentLegacyRest = defineRestRouter(AgentApi)
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
  .withMiddlewareContext(projectRequestContext)
  .handle(async ({ app, input, scope }, context) => {
    const page = await app.list({ ...input, projectId: scope.id });

    return {
      ...page,
      data: page.data.map((agent) => response(agent, app, context.projectSlug)),
    };
  })

  .post("/", "createAgent")
  .keepsRecords()
  .withAudit("agents.create")
  .withInput(createAgentRequestSchema)
  .withCredential("project", { key: true })
  .withPermission("project:update")
  .withOutput(legacyResponse)
  .withStatus(201)
  .withDocs({ summary: "Create an agent; superseded by /api/v1/agents", hide: true })
  .withMiddlewareContext(projectRequestContext)
  .handle(async ({ app, input, scope, actor, key }, context) => {
    const agent = await app.create({
      ...input,
      projectId: scope.id,
      caller: agentCallerOf({ actor, key }),
    });

    return response(agent, app, context.projectSlug);
  })

  .get("/:id", "getAgent")
  .withParams(agentRestParamsSchema)
  .withPermission("project:view")
  .withOutput(legacyResponse)
  .withDocs({ summary: "Get an agent; superseded by /api/v1/agents", hide: true })
  .withMiddlewareContext(projectRequestContext)
  .handle(async ({ app, input, scope }, context) =>
    response(await app.getById({ ...input, projectId: scope.id }), app, context.projectSlug),
  )

  .patch("/:id", "updateAgent")
  .keepsRecords()
  .withAudit("agents.update")
  .withParams(agentRestParamsSchema)
  .withInput(updateAgentRequestSchema)
  .withCredential("project", { key: true })
  .withPermission("project:update")
  .withOutput(legacyResponse)
  .withDocs({ summary: "Update an agent; superseded by /api/v1/agents", hide: true })
  .withMiddlewareContext(projectRequestContext)
  .handle(async ({ app, input, scope, actor, key }, context) =>
    response(
      await app.update({ ...input, projectId: scope.id, caller: agentCallerOf({ actor, key }) }),
      app,
      context.projectSlug,
    ),
  )

  .put("/:id", "replaceAgent")
  .keepsRecords()
  .withAudit("agents.update")
  .withParams(agentRestParamsSchema)
  .withInput(updateAgentRequestSchema)
  .withCredential("project", { key: true })
  .withPermission("project:update")
  .withOutput(legacyResponse)
  .withDocs({
    summary: "Update an agent (PUT keeps partial semantics); superseded by /api/v1/agents",
    hide: true,
  })
  .withMiddlewareContext(projectRequestContext)
  .handle(async ({ app, input, scope, actor, key }, context) =>
    response(
      await app.update({ ...input, projectId: scope.id, caller: agentCallerOf({ actor, key }) }),
      app,
      context.projectSlug,
    ),
  )

  .delete("/:id", "archiveAgent")
  .withAudit("agents.delete")
  .withoutConfirmation("Langy keys cannot hold project:delete")
  .withParams(agentRestParamsSchema)
  .withCredential("project", { key: true })
  .withPermission("project:delete")
  .withOutput(archiveResultSchema)
  .withDocs({ summary: "Archive an agent; superseded by /api/v1/agents", hide: true })
  .handle(async ({ app, input, scope, actor, key }) => {
    const agent = await app.archive({
      ...input,
      projectId: scope.id,
      caller: agentCallerOf({ actor, key }),
    });

    return { id: agent.id, name: agent.name, type: agent.type, archivedAt: agent.archivedAt };
  })

  .build();
