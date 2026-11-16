// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The server half of `governanceKillSwitch.*`: `governance:view` reads, `governance:manage` writes. */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  GovernanceRestApi,
  governanceKillSwitchTrpc,
} from "@langwatch/enterprise-governance-contract";

/** A person in the governance UI: the trail names them, and their stop acts at once. */
function personOf(actor: { type: string; id: string }) {
  return { userId: actor.type === "user" ? actor.id : null, apiKeyId: null };
}

export const governanceKillSwitchTrpcTransport: TrpcRouterDeclaration<
  GovernanceRestApi,
  typeof governanceKillSwitchTrpc
> = defineTrpcRouter(GovernanceRestApi, governanceKillSwitchTrpc)
  .procedure("summaries")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findAgentKillSwitchSummaries(input))

  .procedure("pendingApprovals")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findPendingAgentStops(input))

  .procedure("plan")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.getAgentStopPlan(input))

  .procedure("setPlan")
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.setAgentStopPlan(input))

  .procedure("awsConnections")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findAwsConnections(input))

  .procedure("createAwsConnection")
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.createAwsConnection(input))

  .procedure("deleteAwsConnection")
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.deleteAwsConnection(input))

  .procedure("requestStop")
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) =>
    app.requestAgentStop({
      organizationId: input.organizationId,
      agentId: input.agentId,
      reason: input.reason,
      severity: "high",
      caller: personOf(actor),
    }),
  )

  .procedure("approveStop")
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.approveAgentStop({ ...input, caller: personOf(actor) }))

  .procedure("denyStop")
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.denyAgentStop({ ...input, caller: personOf(actor) }))

  .procedure("restore")
  .withPermission("governance:manage")
  .handle(({ app, input, actor }) => app.restoreAgentStop({ ...input, caller: personOf(actor) }))
  .build();
