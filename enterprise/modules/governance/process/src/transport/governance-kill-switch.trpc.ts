// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `governanceKillSwitch.*`: the AWS connections AWS sources sign with, under
 * `ingestionSources:manage`, since a connection is configuration a source uses.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  GovernanceRestApi,
  governanceKillSwitchTrpc,
} from "@langwatch/enterprise-governance-contract";

export const governanceKillSwitchTrpcTransport: TrpcRouterDeclaration<
  GovernanceRestApi,
  typeof governanceKillSwitchTrpc
> = defineTrpcRouter(GovernanceRestApi, governanceKillSwitchTrpc)
  .procedure("awsConnections")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input }) => app.findAwsConnections(input))

  .procedure("createAwsConnection")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input }) => app.createAwsConnection(input))

  .procedure("deleteAwsConnection")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input }) => app.deleteAwsConnection(input))
  .build();
