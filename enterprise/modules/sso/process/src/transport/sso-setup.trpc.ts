// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `ssoSetup.*`: the organization's own administrator, where
 * `ssoConnections.*` is the back office. The history is close to an audit
 * trail of everyone who has touched the connection, so it is offered to
 * whoever could act on it rather than to every reader who may see it.
 *
 * Spec: specs/identity/sso-connection-history.feature.
 */
import { defineTrpcRouter, type TrpcHandlerActor } from "@langwatch/api/trpc";
import { SsoApi, ssoSetupTrpc, type SsoAdministrator } from "@langwatch/enterprise-sso-contract";

/**
 * Minted from the session, never taken from an input: the administrator this
 * surface authenticated is who the connection's history names.
 */
function administratorOf(actor: TrpcHandlerActor): SsoAdministrator {
  if (actor.type === "user" && actor.impersonatorId !== undefined) {
    return { id: actor.id, impersonatorId: actor.impersonatorId };
  }

  return { id: actor.id };
}

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

  .procedure("claimDomain")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupClaimDomain(input, administratorOf(actor)))

  .procedure("proveDomain")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupProveDomain(input, administratorOf(actor)))

  .procedure("removeDomain")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupRemoveDomain(input, administratorOf(actor)))

  .procedure("checkDomainRecord")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupCheckDomainRecord(input, administratorOf(actor)))

  .procedure("checkDomainFile")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupCheckDomainFile(input, administratorOf(actor)))
  .build();
