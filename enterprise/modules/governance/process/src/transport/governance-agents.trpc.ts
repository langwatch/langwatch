// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The server half of `governanceAgents.*`: `governance:view` reads, `governance:manage` asks, as on main. */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, governanceAgentsTrpc } from "@langwatch/enterprise-governance-contract";

export const governanceAgentsTrpcTransport = defineTrpcRouter(
  GovernanceRestApi,
  governanceAgentsTrpc,
)
  .procedure("syncSources")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.governanceAgentsSyncSources(input))

  .procedure("requestListing")
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.governanceAgentsRequestListing(input))
  .build();
