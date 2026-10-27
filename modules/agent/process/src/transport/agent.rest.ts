/**
 * `/api/v1/agents` - the current agents REST family: CRUD over a project's
 * agents and the relay call to an online connected agent. One flat declaration,
 * mounted by the process on its project door. Scenario serves `/:id/test` (R10).
 */
import {
  AgentApi,
  AgentPayloadTooLargeError,
  agentLabelResponseSchema,
  agentLabelRestBodySchema,
  agentLabelRestParamsSchema,
  agentListResponseSchema,
  agentResponseSchema,
  agentRestGetQuerySchema,
  agentRestParamsSchema,
  agentRestQuerySchema,
  agentVersionListResponseSchema,
  agentVersionsRestParamsSchema,
  archiveResultSchema,
  createAgentRequestSchema,
  relayCallBodySchema,
  relayCallResponseSchema,
  relayPayloadCaps,
  updateAgentRequestSchema,
  type AgentOverview,
} from "@langwatch/agent-contract";
import {
  defineMiddlewareContext,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRequestContext,
  type RestDoorCredential,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { z } from "zod";

import {
  agentConfigWithoutSecrets,
  agentVersionsWithoutSecrets,
} from "../rules/agent-secrets.rules.ts";
import { agentCallerOf } from "../rules/agent-version-caller.rules.ts";

/** The W3C trace context header a call carries, bound by the process from the request. */
export const agentTraceparent = defineMiddlewareContext("traceparent", z.string().nullable());

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
> & {
  platformUrl: string;
  version: number | null;
  labels: { label: string; version: number }[];
  createdBy: { id: string; name: string | null } | null;
  updatedBy: { id: string; name: string | null } | null;
} {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    config: agentConfigWithoutSecrets(agent),
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
    version: agent.version ?? null,
    labels: agent.labels ?? [],
    createdBy: agent.createdBy ?? null,
    updatedBy: agent.updatedBy ?? null,
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
  router: () => RestTransportDeclaration<
    AgentApi,
    RestDoorCredential,
    typeof projectRequestContext | typeof agentTraceparent
  >;
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
      .withMiddlewareContext(projectRequestContext)
      .handle(async ({ app, input, scope }, context) => {
        const page = await app.listWithPresence({
          ...input,
          projectId: scope.id,
          viewerUserId: context.viewerUserId,
        });

        return {
          pagination: page.pagination,
          data: page.data.map((agent) => response(agent, app, context.projectSlug)),
        };
      })

      .post("/", "createAgent")
      .keepsRecords()
      .withAudit("agents.create")
      .withInput(createAgentRequestSchema)
      .withCredential("project", { key: true })
      .withPermission("project:update")
      .withOutput(agentResponseSchema)
      .withStatus(201)
      .withDocs({ summary: "Create an authored agent; connected agents register through the SDK" })
      .withMiddlewareContext(projectRequestContext)
      .handle(async ({ app, input, scope, actor, key }, context) => {
        const created = await app.create({
          ...input,
          projectId: scope.id,
          caller: agentCallerOf({ actor, key }),
        });
        const agent = await app.getById({
          id: created.id,
          projectId: scope.id,
          viewerUserId: context.viewerUserId,
        });

        return response(agent, app, context.projectSlug);
      })

      .get("/:id", "getAgent")
      .withParams(agentRestParamsSchema)
      .withQuery(agentRestGetQuerySchema)
      .withPermission("project:view")
      .withOutput(agentResponseSchema)
      .withDocs({
        summary: "Get an agent in the caller's project",
        description:
          "Reads the latest version unless `label` or `version` is given. The id also takes a suffix: `agent_1:production`, `agent_1:3` or `agent_1:latest`.",
      })
      .withMiddlewareContext(projectRequestContext)
      .handle(async ({ app, input, scope }, context) => {
        const agent = await app.getById({
          ...input,
          projectId: scope.id,
          viewerUserId: context.viewerUserId,
        });

        return response(agent, app, context.projectSlug);
      })

      .patch("/:id", "updateAgent")
      .keepsRecords()
      .withAudit("agents.update")
      .withParams(agentRestParamsSchema)
      .withInput(updateAgentRequestSchema)
      .withCredential("project", { key: true })
      .withPermission("project:update")
      .withOutput(agentResponseSchema)
      .withDocs({ summary: "Update an authored agent" })
      .withMiddlewareContext(projectRequestContext)
      .handle(async ({ app, input, scope, actor, key }, context) => {
        await app.update({ ...input, projectId: scope.id, caller: agentCallerOf({ actor, key }) });
        const agent = await app.getById({
          id: input.id,
          projectId: scope.id,
          viewerUserId: context.viewerUserId,
        });

        return response(agent, app, context.projectSlug);
      })

      .put("/:id", "replaceAgent")
      .keepsRecords()
      .withAudit("agents.update")
      .withParams(agentRestParamsSchema)
      .withInput(updateAgentRequestSchema)
      .withCredential("project", { key: true })
      .withPermission("project:update")
      .withOutput(agentResponseSchema)
      .withDocs({ summary: "Update an authored agent; PUT retains partial update semantics" })
      .withMiddlewareContext(projectRequestContext)
      .handle(async ({ app, input, scope, actor, key }, context) => {
        await app.update({ ...input, projectId: scope.id, caller: agentCallerOf({ actor, key }) });
        const agent = await app.getById({
          id: input.id,
          projectId: scope.id,
          viewerUserId: context.viewerUserId,
        });

        return response(agent, app, context.projectSlug);
      })

      .delete("/:id", "archiveAgent")
      .withAudit("agents.delete")
      .withoutConfirmation("Langy keys cannot hold project:delete")
      .withParams(agentRestParamsSchema)
      .withCredential("project", { key: true })
      .withPermission("project:delete")
      .withOutput(archiveResultSchema)
      .withDocs({ summary: "Archive an agent while keeping its runs" })
      .handle(async ({ app, input, scope, actor, key }) => {
        const agent = await app.archive({
          ...input,
          projectId: scope.id,
          caller: agentCallerOf({ actor, key }),
        });

        return { id: agent.id, name: agent.name, type: agent.type, archivedAt: agent.archivedAt };
      })

      .get("/:agentId/versions", "listAgentVersions")
      .withParams(agentVersionsRestParamsSchema)
      .withPermission("project:view")
      .withOutput(agentVersionListResponseSchema)
      .withDocs({ summary: "List an agent's versions, newest first, with the labels on each" })
      .handle(async ({ app, input, scope }) => {
        const versions = agentVersionsWithoutSecrets(
          await app.listVersions({ projectId: scope.id, agentId: input.agentId }),
        );

        return {
          data: versions.versions,
          labels: versions.labels.map(({ label, version }) => ({ label, version })),
        };
      })

      .put("/:agentId/labels/:label", "assignAgentLabel")
      .keepsRecords()
      .withAudit("agents.assignLabel")
      .withParams(agentLabelRestParamsSchema)
      .withInput(agentLabelRestBodySchema)
      .withCredential("project", { key: true })
      .withPermission("agents:deploy")
      .withOutput(agentLabelResponseSchema)
      .withDocs({
        summary: "Point a deploy label, such as production, at one of the agent's versions",
      })
      .handle(async ({ app, input, scope, actor, key }) => {
        const label = await app.assignLabel({
          projectId: scope.id,
          agentId: input.agentId,
          label: input.label,
          version: input.version,
          caller: agentCallerOf({ actor, key }),
        });

        return { label: label.label, version: label.version, versionId: label.versionId };
      })

      .delete("/:agentId/labels/:label", "removeAgentLabel")
      .withAudit("agents.removeLabel")
      .withConfirmation({
        resource: "agent deploy label",
        action: "delete",
        idParam: "label",
        name: async () => null,
      })
      .withParams(agentLabelRestParamsSchema)
      .withPermission("agents:deploy")
      .withOutput(z.object({ label: z.string(), removed: z.literal(true) }))
      .withDocs({ summary: "Remove a deploy label from an agent" })
      .handle(async ({ app, input, scope }) => {
        await app.removeLabel({ projectId: scope.id, agentId: input.agentId, label: input.label });

        return { label: input.label, removed: true as const };
      })

      .post("/:id/call", "callConnectedAgent")
      .keepsRecords()
      .withoutAudit("run, not a change")
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
      .withMiddlewareContext(projectRequestContext, agentTraceparent)
      .handle(({ app, input: { id, ...turn }, scope, signal }, context, header) =>
        app.call(
          { ...turn, id, projectId: scope.id },
          { viewerUserId: context.viewerUserId, traceparent: header, signal },
        ),
      )

      .build()
  );
}
