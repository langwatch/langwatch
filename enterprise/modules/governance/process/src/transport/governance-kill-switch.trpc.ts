// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `governanceKillSwitch.*`: `governance:view` reads, `governance:manage` writes,
 * each on an Enterprise plan with the agent registry, as the REST routes are.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  GovernanceRestApi,
  governanceKillSwitchTrpc,
} from "@langwatch/enterprise-governance-contract";

const AGENT_REGISTRY = { feature: "AGENT_REGISTRY" } as const;

/** A person in the governance UI: the trail names them, and their stop acts at once. */
function personOf(actor: { type: string; id: string }) {
  return { userId: actor.type === "user" ? actor.id : null, apiKeyId: null };
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
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.setAgentStopPlan(input))

  .procedure("awsConnections")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findAwsConnections(input))

  .procedure("createAwsConnection")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.createAwsConnection(input))

  .procedure("deleteAwsConnection")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.deleteAwsConnection(input))

  .procedure("requestStop")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) =>
    app.requestAgentStop({
      organizationId: input.organizationId,
      agentId: input.agentId,
      reason: input.reason,
      severity: "high",
      ...(input.expectedTargetIds ? { expectedTargetIds: input.expectedTargetIds } : {}),
      caller: personOf(actor),
    }),
  )

  .procedure("approveStop")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.approveAgentStop({ ...input, caller: personOf(actor) }))

  .procedure("denyStop")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.denyAgentStop({ ...input, caller: personOf(actor) }))

  .procedure("restore")
  .withEntitlement("enterprise", AGENT_REGISTRY)
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.restoreAgentStop({ ...input, caller: personOf(actor) }))
  .build();
