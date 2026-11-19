// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The agent kill switch over REST: an agent's stop plan, its stop, and the decisions and restores
 * of a stop, with an organisation API key on an Enterprise plan. A trace rule's webhook action
 * posts to the stop route. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import {
  canonicalBaseResponses,
  canonicalConflictResponses,
  canonicalNotFoundResponses,
  canonicalUnprocessableResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestKeyCredential,
} from "@langwatch/api/rest";
import {
  agentStopAgentParamsSchema,
  type AgentStopCaller,
  agentStopListQuerySchema,
  agentStopListResponseSchema,
  agentStopParamsSchema,
  agentStopPlanResponseSchema,
  agentStopResponseSchema,
  approveAgentStopInputSchema,
  decideAgentStopInputSchema,
  GovernanceRestApi,
  requestAgentStopInputSchema,
  restoreAgentStopInputSchema,
  retryAgentStopInputSchema,
  setAgentStopPlanInputSchema,
} from "@langwatch/enterprise-governance-contract";

const TAGS = ["Governance / Kill Switch"];

const conflictResponses = {
  409: {
    ...canonicalConflictResponses[409],
    description: "The stop or its plan is not in a state that allows this",
  },
};

/**
 * The organisation API key the door resolved acts as itself, its owner kept for the trail and the
 * self-approval check. This door resolves no personal CLI token, so none reaches a handler here.
 */
function agentStopCallerOfKey(key: RestKeyCredential): AgentStopCaller {
  return { userId: key.ownerUserId, apiKeyId: key.apiKeyId };
}

export const agentKillSwitchRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("governance-kill-switch")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")
  // The prefix is shared with `/api/governance`, so each route names its whole path.
  .withAddressing("literal", { v1Twin: true })

  .get("/api/governance/agents/:agentId/stop-plan", "getAgentStopPlan")
  .withParams(agentStopAgentParamsSchema)
  .withPermission("governance:view")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withOutput(agentStopPlanResponseSchema)
  .withDocs({
    operationId: "getApiGovernanceAgentsByIdStopPlan",
    summary: "Get an agent's stop plan",
    tags: TAGS,
    description:
      "The targets a stop of this registry agent acts on, in order: Databricks serving endpoints, Amazon Bedrock agent aliases and gateway virtual keys. An agent outside the organisation's registry is a 404 `agent_registry_entry_not_found`.",
    responses: {
      ...canonicalBaseResponses,
      ...canonicalUnprocessableResponses,
      ...canonicalNotFoundResponses,
    },
  })
  .handle(async ({ app, input, scope }) => ({
    data: await app.getAgentStopPlan({ organizationId: scope.id, agentId: input.agentId }),
  }))

  .put("/api/governance/agents/:agentId/stop-plan", "setAgentStopPlan")
  .withoutAudit("the kill switch service records this row itself, naming the agent and its caller")
  .withoutConfirmation("asked at the organization, where a Langy key holds no grant")
  .withCredential("organization", { key: true })
  .withParams(agentStopAgentParamsSchema)
  .withInput(setAgentStopPlanInputSchema)
  .withPermission("governance:manage")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withOutput(agentStopPlanResponseSchema)
  .withDocs({
    operationId: "putApiGovernanceAgentsByIdStopPlan",
    summary: "Replace an agent's stop plan",
    tags: TAGS,
    description:
      "Replaces every target at once; an empty list clears the plan. Each target must name what the organisation holds: a Databricks governance source, a stored AWS connection or a gateway virtual key. Anything else is a 422 `agent_stop_target_invalid` naming the target's position. Send `expectedVersion` with the `version` you read to refuse the save (409 `agent_stop_plan_conflict`) when someone else saved the plan since. A target removed from the plan also leaves the agent's open stop, so it no longer holds that stop or its restore from finishing; a restore leaves it as it is.",
    responses: {
      ...canonicalBaseResponses,
      ...canonicalUnprocessableResponses,
      ...canonicalNotFoundResponses,
      ...conflictResponses,
    },
  })
  .handle(async ({ app, input, scope, key }) => ({
    data: await app.setAgentStopPlan({
      organizationId: scope.id,
      agentId: input.agentId,
      targets: input.targets,
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      caller: agentStopCallerOfKey(key),
    }),
  }))

  .post("/api/governance/agents/:agentId/stop", "requestAgentStop")
  .withoutAudit("the kill switch service records this row itself, with the stop and its caller")
  .withoutConfirmation("asked at the organization, where a Langy key holds no grant")
  .withCredential("organization", { key: true })
  .withParams(agentStopAgentParamsSchema)
  .withInput(requestAgentStopInputSchema)
  .withPermission("governance:manage")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withStatus(202)
  .withOutput(agentStopResponseSchema)
  .withDocs({
    operationId: "postApiGovernanceAgentsByIdStop",
    summary: "Stop an agent",
    tags: TAGS,
    description:
      "Requests a stop of the agent on every target of its plan. Send `expectedTargetIds` with the plan's target ids to refuse the stop (`agent_stop_plan_changed`) when the plan changed since you read it. A `critical` stop is applied at once; any other severity waits for an approval by another credential (`status: pending_approval`). The targets are applied in the background: read the stop back to follow each target's outcome. A trace rule's webhook action can post here with the API key in its `Authorization` header.",
    responses: {
      ...canonicalBaseResponses,
      ...canonicalUnprocessableResponses,
      ...canonicalNotFoundResponses,
      ...conflictResponses,
    },
  })
  .handle(async ({ app, input, scope, key }) => ({
    data: await app.requestAgentStop({
      organizationId: scope.id,
      agentId: input.agentId,
      reason: input.reason,
      severity: input.severity,
      ...(input.expectedTargetIds ? { expectedTargetIds: input.expectedTargetIds } : {}),
      caller: agentStopCallerOfKey(key),
    }),
  }))

  .get("/api/governance/agents/:agentId/stop", "getLatestAgentStop")
  .withParams(agentStopAgentParamsSchema)
  .withPermission("governance:view")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withOutput(agentStopResponseSchema)
  .withDocs({
    operationId: "getApiGovernanceAgentsByIdStop",
    summary: "Get an agent's latest stop",
    tags: TAGS,
    description:
      "The agent's latest stop with its status and every target's outcome (`pending`, `applied`, `failed`, `reverted`, `revert_failed`) and error code. An agent that was never stopped is a 404 `agent_stop_not_found`.",
    responses: {
      ...canonicalBaseResponses,
      ...canonicalUnprocessableResponses,
      ...canonicalNotFoundResponses,
    },
  })
  .handle(async ({ app, input, scope }) => ({
    data: await app.getLatestAgentStop({ organizationId: scope.id, agentId: input.agentId }),
  }))

  .get("/api/governance/agent-stops", "listAgentStops")
  .withQuery(agentStopListQuerySchema)
  .withPermission("governance:view")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withOutput(agentStopListResponseSchema)
  .withDocs({
    operationId: "getApiGovernanceAgentStops",
    summary: "List the organisation's agent stops",
    tags: TAGS,
    description:
      "The organisation's stops, latest request first, `limit` at a time (default 50, at most 200). Pass `next_cursor` back as `cursor` for the next page; it is null on the last page. `status=pending_approval` lists the stops waiting for a decision.",
    responses: { ...canonicalBaseResponses, ...canonicalUnprocessableResponses },
  })
  .handle(({ app, input, scope }) =>
    app.listAgentStops({
      organizationId: scope.id,
      limit: input.limit,
      ...(input.status ? { statuses: [input.status] } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    }),
  )

  .post("/api/governance/agent-stops/:stopId/approve", "approveAgentStop")
  .withoutAudit("the kill switch service records this row itself, with the stop and its caller")
  .withoutConfirmation("asked at the organization, where a Langy key holds no grant")
  .withCredential("organization", { key: true })
  .withParams(agentStopParamsSchema)
  .withInput(approveAgentStopInputSchema)
  .withPermission("governance:manage")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withOutput(agentStopResponseSchema)
  .withDocs({
    operationId: "postApiGovernanceAgentStopsByIdApprove",
    summary: "Approve a pending stop",
    tags: TAGS,
    description:
      "Approves a stop waiting for a decision; its targets are then applied. Send `expectedTargetIds` with the stop's target ids you reviewed to refuse the approval (409 `agent_stop_plan_changed`) when its targets changed since. A stop that is no longer pending is a 409 `agent_stop_not_pending`; the key that requested the stop cannot approve it (409 `agent_stop_self_approval`).",
    responses: {
      ...canonicalBaseResponses,
      ...canonicalUnprocessableResponses,
      ...canonicalNotFoundResponses,
      ...conflictResponses,
    },
  })
  .handle(async ({ app, input, scope, key }) => ({
    data: await app.approveAgentStop({
      organizationId: scope.id,
      stopId: input.stopId,
      ...(input.note ? { note: input.note } : {}),
      ...(input.expectedTargetIds ? { expectedTargetIds: input.expectedTargetIds } : {}),
      caller: agentStopCallerOfKey(key),
    }),
  }))

  .post("/api/governance/agent-stops/:stopId/deny", "denyAgentStop")
  .withoutAudit("the kill switch service records this row itself, with the stop and its caller")
  .withoutConfirmation("asked at the organization, where a Langy key holds no grant")
  .withCredential("organization", { key: true })
  .withParams(agentStopParamsSchema)
  .withInput(decideAgentStopInputSchema)
  .withPermission("governance:manage")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withOutput(agentStopResponseSchema)
  .withDocs({
    operationId: "postApiGovernanceAgentStopsByIdDeny",
    summary: "Deny a pending stop",
    tags: TAGS,
    description:
      "Denies a stop waiting for a decision; no target is applied. A stop that is no longer pending is a 409 `agent_stop_not_pending`.",
    responses: {
      ...canonicalBaseResponses,
      ...canonicalUnprocessableResponses,
      ...canonicalNotFoundResponses,
      ...conflictResponses,
    },
  })
  .handle(async ({ app, input, scope, key }) => ({
    data: await app.denyAgentStop({
      organizationId: scope.id,
      stopId: input.stopId,
      ...(input.note ? { note: input.note } : {}),
      caller: agentStopCallerOfKey(key),
    }),
  }))

  .post("/api/governance/agent-stops/:stopId/restore", "restoreAgentStop")
  .withoutAudit("the kill switch service records this row itself, with the stop and its caller")
  .withoutConfirmation("asked at the organization, where a Langy key holds no grant")
  .withCredential("organization", { key: true })
  .withParams(agentStopParamsSchema)
  .withInput(restoreAgentStopInputSchema)
  .withPermission("governance:manage")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withStatus(202)
  .withOutput(agentStopResponseSchema)
  .withDocs({
    operationId: "postApiGovernanceAgentStopsByIdRestore",
    summary: "Restore a stopped agent",
    tags: TAGS,
    description:
      "Reverts the targets the stop applied: serving endpoints are started, Bedrock aliases accept invocations again and virtual keys are enabled. Targets the stop failed to apply are left alone. Only a `quarantined`, `stop_failed` or `restore_failed` stop can be restored (409 `agent_stop_not_restorable`).",
    responses: {
      ...canonicalBaseResponses,
      ...canonicalUnprocessableResponses,
      ...canonicalNotFoundResponses,
      ...conflictResponses,
    },
  })
  .handle(async ({ app, input, scope, key }) => ({
    data: await app.restoreAgentStop({
      organizationId: scope.id,
      stopId: input.stopId,
      caller: agentStopCallerOfKey(key),
    }),
  }))

  .post("/api/governance/agent-stops/:stopId/retry", "retryAgentStop")
  .withoutAudit("the kill switch service records this row itself, with the stop and its caller")
  .withoutConfirmation("asked at the organization, where a Langy key holds no grant")
  .withCredential("organization", { key: true })
  .withParams(agentStopParamsSchema)
  .withInput(retryAgentStopInputSchema)
  .withPermission("governance:manage")
  .withEntitlement("enterprise", { feature: "AGENT_REGISTRY" })
  .withStatus(202)
  .withOutput(agentStopResponseSchema)
  .withDocs({
    operationId: "postApiGovernanceAgentStopsByIdRetry",
    summary: "Retry a stop",
    tags: TAGS,
    description:
      "Applies the stop again to every target it has not stopped: the ones that failed, the ones a restore turned back on, and plan targets added since the stop was requested. Targets already stopped are left alone. Only a `quarantined`, `stop_failed` or `restore_failed` stop can be retried (409 `agent_stop_not_retryable`). The stop goes back to `stopping` and announces its new outcome.",
    responses: {
      ...canonicalBaseResponses,
      ...canonicalUnprocessableResponses,
      ...canonicalNotFoundResponses,
      ...conflictResponses,
    },
  })
  .handle(async ({ app, input, scope, key }) => ({
    data: await app.retryAgentStop({
      organizationId: scope.id,
      stopId: input.stopId,
      caller: agentStopCallerOfKey(key),
    }),
  }))
  .build();
