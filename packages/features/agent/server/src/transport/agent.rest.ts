import {
  AgentApi,
  agentListResponseSchema,
  agentResponseSchema,
  agentRestParamsSchema,
  agentRestQuerySchema,
  agentTestRunResponseSchema,
  archiveResultSchema,
  createAgentRequestSchema,
  updateAgentRequestSchema,
  type AgentOverview,
} from "@langwatch/agent-contract";
import { defineRestRouter, MANAGEMENT_API_VERSION, projectRestFacts } from "@langwatch/api/rest";
import {
  createFamilyErrorHandler,
  mountProjectRestRouter,
  NotFoundError,
  UnprocessableEntityError,
  type AppRestSecurity,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  AgentBusyError,
  AgentNotFoundError,
  InvalidAgentConfigError,
} from "@langwatch/agent-contract";
import { z } from "zod";
import { registerCallEndpoint, type AgentCallDeps } from "./agent-call.rest.ts";
import { registerConnectEndpoints } from "./agent-connect.rest.ts";

export type AgentPlatformUrlBuilder = (input: {
  projectSlug: string;
  agentId: string;
  agentType: string;
}) => string;

export function createAgentRestRouter(platformUrl: AgentPlatformUrlBuilder) {
  const response = (agent: AgentOverview, projectSlug: string) => ({
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
    platformUrl: platformUrl({ projectSlug, agentId: agent.id, agentType: agent.type }),
  });
  return defineRestRouter(AgentApi)
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
        data: page.data.map((agent) => response(agent, facts.projectSlug)),
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

      return response(agent, facts.projectSlug);
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

      return response(agent, facts.projectSlug);
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

      return response(agent, facts.projectSlug);
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

      return response(agent, facts.projectSlug);
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
    .build();
}

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

export interface AgentsV1Deps {
  security: AppRestSecurity;
  agents: () => AgentApi;
  agentPlatformUrl: AgentPlatformUrlBuilder;
  connect?: { relayMaxPayloadMb?: number };
  call?: Omit<AgentCallDeps, "agents">;
}

export function createAgentV1RestApp(deps: AgentsV1Deps): MountableRestApp {
  const family = deps.security.createProjectVersionedApp({
    name: "agents-v1",
    basePath: "/api/v1/agents",
    errorEnvelope: "legacy",
    staticGeneration: "v1",
    errorHandler: agentRestErrorHandler,
  });

  if (deps.connect) {
    registerConnectEndpoints({ family, app: deps.agents, ...deps.connect });
  }
  mountProjectRestRouter({
    family,
    transport: createAgentRestRouter(deps.agentPlatformUrl).router(),
    app: deps.agents,
  });
  if (deps.call) registerCallEndpoint({ family, deps: { agents: deps.agents, ...deps.call } });

  return family.service.build();
}
