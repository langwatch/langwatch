// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `personalVirtualKeys.*`. `list` refuses non-members itself and
 * widens past the caller only under `virtualKeys:viewOtherPersonal`, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  GovernanceRestApi,
  personalVirtualKeysTrpc,
} from "@langwatch/enterprise-governance-contract";

const MEMBERSHIP_CHECKED_BY_THE_APPLICATION = {
  reason: "own keys only, unless virtualKeys:viewOtherPersonal is held at this organization",
  allow: {
    organizationId: "the application refuses non-members before reading any key",
  },
} as const;

export const personalVirtualKeysTrpcTransport = defineTrpcRouter(
  GovernanceRestApi,
  personalVirtualKeysTrpc,
)
  .procedure("list")
  .noPermission(MEMBERSHIP_CHECKED_BY_THE_APPLICATION)
  .handle(({ app, input, actor }) => app.listPersonalVirtualKeys(input, { id: actor.id }))

  .procedure("issuePersonal")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) => app.issuePersonalVirtualKey(input, { id: actor.id }))

  .procedure("revokePersonal")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) => {
    await app.revokePersonalVirtualKey(input, { id: actor.id });
    return { ok: true };
  })
  .build();
