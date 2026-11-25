// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The server half of `governanceRegistry.*`: settings read under `governance:view`, saved under `ingestionSources:manage`. */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  GovernanceRestApi,
  governanceRegistryTrpc,
} from "@langwatch/enterprise-governance-contract";

export const governanceRegistryTrpcTransport: TrpcRouterDeclaration<
  GovernanceRestApi,
  typeof governanceRegistryTrpc
> = defineTrpcRouter(GovernanceRestApi, governanceRegistryTrpc)
  .procedure("settings")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.getRegistrySettings(input))

  .procedure("saveSettings")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input }) =>
    app.saveRegistrySettings({
      organizationId: input.organizationId,
      dormantAfterDays: input.dormant_after_days,
    }),
  )
  .build();
