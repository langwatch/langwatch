// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The server half of `sessionPolicy.*`: read under `organization:view`, written under `organization:manage`, as on main. */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, sessionPolicyTrpc } from "@langwatch/enterprise-governance-contract";

export const sessionPolicyTrpcTransport = defineTrpcRouter(GovernanceRestApi, sessionPolicyTrpc)
  .procedure("get")
  .withPermission("organization:view")
  .handle(({ app, input }) => app.sessionPolicyGet(input))

  .procedure("setMaxDuration")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.sessionPolicySetMaxDuration(input))
  .build();
