// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `personalSessions.*`: a person's own CLI devices, gated on
 * `organization:view` and always answered for the caller alone, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, personalSessionsTrpc } from "@langwatch/enterprise-governance-contract";

export const personalSessionsTrpcTransport = defineTrpcRouter(
  GovernanceRestApi,
  personalSessionsTrpc,
)
  .procedure("list")
  .withPermission("organization:view")
  .handle(({ app, actor }) => app.cliSessionListForUser({ userId: actor.id }))

  .procedure("revoke")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.cliSessionRevoke({ userId: actor.id, sessionStartedAtMs: input.sessionStartedAtMs }),
  )

  .procedure("revokeAll")
  .withPermission("organization:view")
  .handle(({ app, actor }) => app.cliSessionRevokeAll({ userId: actor.id }))
  .build();
