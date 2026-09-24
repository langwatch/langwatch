// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `anomalyRules.*`: `anomalyRules:view` reads, `anomalyRules:manage`
 * writes. Main's Enterprise gate is the application's per-organization refusal.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, anomalyRulesTrpc } from "@langwatch/enterprise-governance-contract";

export const anomalyRulesTrpcTransport = defineTrpcRouter(GovernanceRestApi, anomalyRulesTrpc)
  .procedure("list")
  .withPermission("anomalyRules:view")
  .handle(({ app, input, actor }) =>
    app.anomalyRuleList({ organizationId: input.organizationId }, actor),
  )

  .procedure("get")
  .withPermission("anomalyRules:view")
  .handle(({ app, input, actor }) => app.anomalyRuleGetById(input, actor))

  .procedure("create")
  .withPermission("anomalyRules:manage")
  .handle(({ app, input, actor }) =>
    app.anomalyRuleCreate({ ...input, actorUserId: actor.id }, actor),
  )

  .procedure("update")
  .withPermission("anomalyRules:manage")
  .handle(({ app, input, actor }) => app.anomalyRuleUpdate(input, actor))

  .procedure("archive")
  .withPermission("anomalyRules:manage")
  .handle(({ app, input, actor }) => app.anomalyRuleArchive(input, actor))
  .build();
