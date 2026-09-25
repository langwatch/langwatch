// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `personalVirtualKeys.*`. `list` refuses non-members itself and
 * widens past the caller only under `virtualKeys:viewOtherPersonal`, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  EnterpriseGatewayApi,
  personalVirtualKeysTrpc,
} from "@langwatch/enterprise-gateway-contract";

const MEMBERSHIP_CHECKED_BY_THE_APPLICATION = {
  reason: "own keys only, unless virtualKeys:viewOtherPersonal is held at this organization",
  allow: {
    organizationId: "the application refuses non-members before reading any key",
  },
} as const;

export const personalVirtualKeysTrpcTransport = defineTrpcRouter(
  EnterpriseGatewayApi,
  personalVirtualKeysTrpc,
)
  .procedure("list")
  .noPermission(MEMBERSHIP_CHECKED_BY_THE_APPLICATION)
  .handle(({ app, input, actor }) =>
    app.listPersonalVirtualKeys({ ...input, actorUserId: actor.id }),
  )

  .procedure("issuePersonal")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.issuePersonalVirtualKey({ ...input, actorUserId: actor.id }),
  )

  .procedure("revokePersonal")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) => {
    await app.revokePersonalVirtualKey({ ...input, actorUserId: actor.id });
    return { ok: true };
  })
  .build();
