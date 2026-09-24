// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `governance.*`. The actor lookup collapses every refusal to
 * null, so a `governance:view` holder learns nothing about who exists elsewhere, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, governanceTrpc } from "@langwatch/enterprise-governance-contract";

export const governanceTrpcTransport = defineTrpcRouter(GovernanceRestApi, governanceTrpc)
  .procedure("resolveActorPersonalProject")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.findActorWorkspace(input))
  .build();
