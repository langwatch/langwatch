// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `governanceKillSwitch.*`: `governance:view` reads, `governance:manage` writes,
 * each on an Enterprise plan with the agent registry, as the REST routes are.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  type AgentStopCaller,
  GOVERNANCE_UI_STOP_SEVERITY,
  GovernanceRestApi,
  governanceKillSwitchTrpc,
} from "@langwatch/enterprise-governance-contract";

const AGENT_REGISTRY = { feature: "AGENT_REGISTRY" } as const;
const SELF_AUDITED = "the kill switch service records this row itself, refusals included";

/** A person in the governance UI: the trail names them and any operator behind them. */
function personOf(actor: { type: string; id: string; impersonatorId?: string }): AgentStopCaller {
  if (actor.type !== "user") return { userId: null, apiKeyId: null };
  const { impersonatorId } = actor;
  return { userId: actor.id, apiKeyId: null, ...(impersonatorId ? { impersonatorId } : {}) };
}

/** The person an AWS connection write names, and the operator behind an impersonation. */
function connectionCallerOf(actor: { type: string; id: string; impersonatorId?: string }) {
  const { userId, impersonatorId } = personOf(actor);
  return { userId, ...(impersonatorId ? { impersonatorId } : {}) };
}

export const governanceKillSwitchTrpcTransport: TrpcRouterDeclaration<
  GovernanceRestApi,
  typeof governanceKillSwitchTrpc
> = defineTrpcRouter(GovernanceRestApi, governanceKillSwitchTrpc)
  .procedure("summaries")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findAgentKillSwitchSummaries(input))

  .procedure("pendingApprovals")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findPendingAgentStops(input))

  .procedure("plan")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:view")
  .handle(({ app, input }) => app.getAgentStopPlan(input))

  .procedure("setPlan")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withoutAudit(SELF_AUDITED)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.setAgentStopPlan({ ...input, caller: personOf(actor) }))

  .procedure("awsConnections")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findAwsConnections(input))

  .procedure("createAwsConnection")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withoutAudit(SELF_AUDITED)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) =>
    app.createAwsConnection({ ...input, ...connectionCallerOf(actor) }),
  )

  .procedure("deleteAwsConnection")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withoutAudit(SELF_AUDITED)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) =>
    app.deleteAwsConnection({ ...input, ...connectionCallerOf(actor) }),
  )

  .procedure("requestStop")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withoutAudit(SELF_AUDITED)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) =>
    app.requestAgentStop({
      organizationId: input.organizationId,
      agentId: input.agentId,
      reason: input.reason,
      severity: GOVERNANCE_UI_STOP_SEVERITY,
      ...(input.expectedTargetIds ? { expectedTargetIds: input.expectedTargetIds } : {}),
      caller: personOf(actor),
    }),
  )

  .procedure("approveStop")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withoutAudit(SELF_AUDITED)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.approveAgentStop({ ...input, caller: personOf(actor) }))

  .procedure("denyStop")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withoutAudit(SELF_AUDITED)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.denyAgentStop({ ...input, caller: personOf(actor) }))

  .procedure("restore")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withoutAudit(SELF_AUDITED)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.restoreAgentStop({ ...input, caller: personOf(actor) }))

  .procedure("retryStop")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withoutAudit(SELF_AUDITED)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.retryAgentStop({ ...input, caller: personOf(actor) }))
  .build();
