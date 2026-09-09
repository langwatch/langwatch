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
  archiveResultSchema,
  createAgentRequestSchema,
  relayCallBodySchema,
  relayCallResponseSchema,
  relayPayloadCaps,
  updateAgentRequestSchema,
  type AgentOverview,
} from "@langwatch/agent-contract";
import {
  createFamilyErrorHandler,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  NotFoundError,
  projectRestFacts,
  UnprocessableEntityError,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  AgentBusyError,
  AgentNotFoundError,
  InvalidAgentConfigError,
} from "@langwatch/agent-contract";
import { z } from "zod";

export { relayCallBodySchema, relayCallResponseSchema } from "@langwatch/agent-contract";

const traceparent = defineRestMiddleware("traceparent", z.string().nullable());

function response(agent: AgentOverview, app: AgentApi, projectSlug: string) {
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

const relayMaxBytes = relayPayloadCaps().envelopeBytes;

export const agentRest = defineRestRouter(AgentApi)
  .withNamespace("agents")
  .withVersion(MANAGEMENT_API_VERSION)

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

  .get("/:id", "getAgent")
  .withParams(agentRestParamsSchema)
  .withPermission("project:view")
  .withOutput(agentResponseSchema)
  .withDocs({ summary: "Get an agent in the caller's project" })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) => {
    const agent = await app.getById({
      ...input,
      projectId: scope.id,
      viewerUserId: facts.viewerUserId,
    });

    return response(agent, app, facts.projectSlug);
  })

  .patch("/:id", "updateAgent")
  .withParams(agentRestParamsSchema)
  .withInput(updateAgentRequestSchema)
  .withPermission("project:update")
  .withOutput(agentResponseSchema)
  .withDocs({ summary: "Update an authored agent" })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) => {
    await app.update({ ...input, projectId: scope.id });
    const agent = await app.getById({
      id: input.id,
      projectId: scope.id,
      viewerUserId: facts.viewerUserId,
    });

    return response(agent, app, facts.projectSlug);
  })

  .put("/:id", "replaceAgent")
  .withParams(agentRestParamsSchema)
  .withInput(updateAgentRequestSchema)
  .withPermission("project:update")
  .withOutput(agentResponseSchema)
  .withDocs({ summary: "Update an authored agent; PUT retains partial update semantics" })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) => {
    await app.update({ ...input, projectId: scope.id });
    const agent = await app.getById({
      id: input.id,
      projectId: scope.id,
      viewerUserId: facts.viewerUserId,
    });

    return response(agent, app, facts.projectSlug);
  })

  .delete("/:id", "archiveAgent")
  .withParams(agentRestParamsSchema)
  .withPermission("project:delete")
  .withOutput(archiveResultSchema)
  .withDocs({ summary: "Archive an agent while keeping its runs" })
  .handle(async ({ app, input, scope }) => {
    const agent = await app.archive({ ...input, projectId: scope.id });

    return { id: agent.id, name: agent.name, type: agent.type, archivedAt: agent.archivedAt };
  })

  .post("/:id/test", "testAgent")
  .withParams(agentRestParamsSchema)
  .withPermission("scenarios:create")
  .withOutput(agentTestRunResponseSchema)
  .withDocs({ summary: "Schedule a scripted test run and return its run identifiers" })
  .withMiddleware(projectRestFacts)
  .handle(({ app, input, scope }, facts) =>
    app.testRun({ agentId: input.id, projectId: scope.id, actorId: facts.actorId }),
  )

  .post("/:id/call", "callConnectedAgent")
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
  .withMiddleware(projectRestFacts, traceparent)
  .handle(({ app, input, scope, signal }, facts, header) =>
    app.call(
      { ...input, projectId: scope.id },
      { viewerUserId: facts.viewerUserId, traceparent: header, signal },
    ),
  )

  .build();

export const agentRestErrorHandler = (boundary: RestErrorHandler): RestErrorHandler =>
  createFamilyErrorHandler({
    boundary,
    loggerName: "langwatch:api:v1:agents:errors",
    label: "Agent API Error",
    headers: (error): Record<string, string> =>
      error instanceof AgentBusyError
        ? { "Retry-After": String(Math.ceil(z.number().parse(error.meta.retryAfterMs) / 1000)) }
        : {},
    mapError: (error) => {
      if (error instanceof AgentNotFoundError) return new NotFoundError(error.message);
      if (error instanceof InvalidAgentConfigError)
        return new UnprocessableEntityError(error.message);
      return error;
    },
  });
