// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `governanceCost.*`: figures under `governanceCost:view`, as on main; the
 * spender breakdown joins identity labels, so it also needs `governance:view`. Main's Enterprise
 * gate is the application's per-organization refusal. @see specs/governance/governance-cost-screen.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, governanceCostTrpc } from "@langwatch/enterprise-governance-contract";

export const governanceCostTrpcTransport = defineTrpcRouter(GovernanceRestApi, governanceCostTrpc)
  .procedure("summary")
  .withPermission("governanceCost:view")
  .handle(({ app, input, actor }) => app.governanceCostSummary(input, actor))

  .procedure("dailyByProvider")
  .withPermission("governanceCost:view")
  .handle(({ app, input, actor }) => app.governanceCostDailyByProvider(input, actor))

  .procedure("spendByModel")
  .withPermission("governanceCost:view")
  .handle(({ app, input, actor }) => app.governanceCostSpendByModel(input, actor))

  .procedure("periodRecords")
  .withPermission("governanceCost:view")
  .handle(({ app, input, actor }) => app.governanceCostPeriodRecords(input, actor))

  .procedure("spenders")
  .withPermission(["governanceCost:view", "governance:view"])
  .handle(({ app, input, actor }) => app.governanceCostSpenders(input, actor))
  .build();
