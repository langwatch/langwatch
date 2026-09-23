/**
 * `/api/v1/agents` - the current agents REST family: CRUD over a project's
 * agents, a scripted test run, and the relay call to an online connected
 * agent. One flat declaration, mounted by the process on its project door.
 */
import {
  AgentApi,
  AgentPayloadTooLargeError,
  agentListResponseSchema,
  agentResponseSchema,
  agentRestParamsSchema,
  agentRestQuerySchema,
  agentTestRunResponseSchema,
  testAgentBodySchema,
  archiveResultSchema,
  createAgentRequestSchema,
  relayCallBodySchema,
  relayCallResponseSchema,
  relayPayloadCaps,
  updateAgentRequestSchema,
  type AgentOverview,
} from "@langwatch/agent-contract";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { z } from "zod";

export { relayCallBodySchema, relayCallResponseSchema } from "@langwatch/agent-contract";

/** The W3C trace context header a call carries, bound by the process from the request. */
export const agentTraceparent = defineRestMiddleware("traceparent", z.string().nullable());

function response(
  agent: AgentOverview,
  app: AgentApi,
  projectSlug: string,
): Pick<
  AgentOverview,
  | "id"
  | "name"
  | "type"
  | "config"
  | "environment"
  | "ownerUserId"
  | "hostLabel"
  | "lastSeenAt"
  | "parameters"
  | "owner"
  | "status"
  | "instances"
  | "selectable"
  | "notSelectableReason"
  | "createdAt"
  | "updatedAt"
> & { platformUrl: string } {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    config: agent.config,
    environment: agent.environment,
    ownerUserId: agent.ownerUserId,
    hostLabel: agent.hostLabel,
    lastSeenAt: agent.lastSeenAt,
    parameters: agent.parameters,
    owner: agent.owner,
    status: agent.status,
    instances: agent.instances,
    selectable: agent.selectable,
    notSelectableReason: agent.notSelectableReason,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    platformUrl: app.platformUrl({ projectSlug, agentId: agent.id, agentType: agent.type }),
  };
}

/**
 * Builds the `/api/v1/agents` family. `relayMaxPayloadMb` is resolved by the
 * caller at mount time (`LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`); it must never
 * be read at module load, or every deployment gets the protocol default.
 */
export function createAgentRest(relayMaxPayloadMb?: number): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AgentApi>;
}> {
  const relayMaxBytes = relayPayloadCaps(relayMaxPayloadMb).envelopeBytes;

  return (
    defineRestRouter(AgentApi)
      .withNamespace("agents")
      .withVersion(MANAGEMENT_API_VERSION)
      // `/api/v1/agents` is this family's whole contract: the bare `/api/agents`
      // belongs to the deprecated legacy family, which answers a reduced field
      // set there.
      .withAddressing("v1-only")

      .get("/", "listAgents")
      .withQuery(agentRestQuerySchema)
      .withPermission("project:view")
      .withOutput(agentListResponseSchema)
      .withDocs({ summary: "List agents with their current presence and owner" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, facts) => {
        const page = await app.listWithPresence({
          ...input,
          projectId: scope.id,
          viewerUserId: facts.viewerUserId,
        });

        return {
          pagination: page.pagination,
          data: page.data.map((agent) => response(agent, app, facts.projectSlug)),
        };
      })

      .post("/", "createAgent")
      .withInput(createAgentRequestSchema)
      .withPermission("project:update")
      .withOutput(agentResponseSchema)
      .withStatus(201)
      .withDocs({ summary: "Create an authored agent; connected agents register through the SDK" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, facts) => {
        const created = await app.create({ ...input, projectId: scope.id });
        const agent = await app.getById({
          id: created.id,
          projectId: scope.id,
          viewerUserId: facts.viewerUserId,
        });

        return response(agent, app, facts.projectSlug);
      })

      .get("/:agentId", "getAgent")
      .withParams(agentRestParamsSchema)
      .withPermission("project:view")
      .withOutput(agentResponseSchema)
      .withDocs({ summary: "Get an agent in the caller's project" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, facts) => {
        const agent = await app.getById({
          ...input,
          id: input.agentId,
          projectId: scope.id,
          viewerUserId: facts.viewerUserId,
        });

        return response(agent, app, facts.projectSlug);
      })

      .patch("/:agentId", "updateAgent")
      .withParams(agentRestParamsSchema)
      .withInput(updateAgentRequestSchema)
      .withPermission("project:update")
      .withOutput(agentResponseSchema)
      .withDocs({ summary: "Update an authored agent" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, facts) => {
        await app.update({ ...input, id: input.agentId, projectId: scope.id });
        const agent = await app.getById({
          id: input.agentId,
          projectId: scope.id,
          viewerUserId: facts.viewerUserId,
        });

        return response(agent, app, facts.projectSlug);
      })

      .put("/:agentId", "replaceAgent")
      .withParams(agentRestParamsSchema)
      .withInput(updateAgentRequestSchema)
      .withPermission("project:update")
      .withOutput(agentResponseSchema)
      .withDocs({ summary: "Update an authored agent; PUT retains partial update semantics" })
      .withMiddleware(projectRestFacts)
      .handle(async ({ app, input, scope }, facts) => {
        await app.update({ ...input, id: input.agentId, projectId: scope.id });
        const agent = await app.getById({
          id: input.agentId,
          projectId: scope.id,
          viewerUserId: facts.viewerUserId,
        });

        return response(agent, app, facts.projectSlug);
      })

      .delete("/:agentId", "archiveAgent")
      .withParams(agentRestParamsSchema)
      .withPermission("project:delete")
      .withOutput(archiveResultSchema)
      .withDocs({ summary: "Archive an agent while keeping its runs" })
      .handle(async ({ app, input, scope }) => {
        const agent = await app.archive({ ...input, id: input.agentId, projectId: scope.id });

        return { id: agent.id, name: agent.name, type: agent.type, archivedAt: agent.archivedAt };
      })

      .post("/:agentId/test", "testAgent")
      .withParams(agentRestParamsSchema)
      .withInput(testAgentBodySchema)
      .withPermission("scenarios:create")
      .withOutput(agentTestRunResponseSchema)
      .withDocs({ summary: "Schedule a scripted test run and return its run identifiers" })
      .withMiddleware(projectRestFacts)
      .handle(({ app, input, scope }, facts) =>
        app.testRun({ agentId: input.agentId, projectId: scope.id, actorId: facts.actorId }),
      )

      .post("/:agentId/call", "callConnectedAgent")
      .withParams(agentRestParamsSchema)
      .withInput(relayCallBodySchema)
      .withPermission("scenarios:create")
      .withOutput(relayCallResponseSchema)
      .withDocs({ summary: "Send one conversation turn to an online connected agent" })
      .withBodyLimit({
        maxBytes: relayMaxBytes,
        onExceeded: () =>
          new AgentPayloadTooLargeError({ what: "envelope", limitBytes: relayMaxBytes }),
      })
      .withMiddleware(projectRestFacts, agentTraceparent)
      .handle(({ app, input, scope, signal }, facts, header) =>
        app.call(
          { ...input, id: input.agentId, projectId: scope.id },
          { viewerUserId: facts.viewerUserId, traceparent: header, signal },
        ),
      )

      .build()
  );
}
