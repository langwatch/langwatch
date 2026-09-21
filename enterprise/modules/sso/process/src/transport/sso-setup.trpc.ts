// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `ssoSetup.*`: the organization's own administrator, where
 * `ssoConnections.*` is the back office. The history is close to an audit
 * trail of everyone who has touched the connection, so it is offered to
 * whoever could act on it rather than to every reader who may see it.
 *
 * Spec: specs/identity/sso-connection-history.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { SsoApi, ssoSetupTrpc } from "@langwatch/enterprise-sso-contract";

export const ssoSetupTrpcTransport = defineTrpcRouter(SsoApi, ssoSetupTrpc)
  .procedure("getHistory")
  .withPermission("sso:manage")
  .handle(({ app, input }) => app.findConnectionHistory(input))

  .procedure("onHistoryActivity")
  .withPermission("sso:manage")
  .handle(({ app, input, signal }) =>
    app.watchConnectionHistory({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      signal,
    }),
  )
  .build();
