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
  .procedure("getSetup")
  .withPermission("sso:view")
  .handle(({ app, input }) => app.getSetup(input))

  /** The wire answers the cutover itself, as the surface it replaces did;
   *  identity and this module carry it inside an answer of its own. */
  .procedure("getMigrationProgress")
  .withPermission("sso:view")
  .handle(async ({ app, input }) => (await app.getMigrationProgress(input)).migration)

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

  /** The Enterprise plan gate is NOT declared here and is not gone: it runs
   *  second, inside the application, so a caller who does not hold
   *  `sso:manage` is told that rather than told what was not bought. */
  .procedure("register")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupRegister(input, administratorOf(actor)))

  .procedure("startLegacyMigration")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupStartLegacyMigration(input, administratorOf(actor)))

  /** The plan gate runs inside the application and only for `direct`: rolling
   *  back to the grandfathered provider stays reachable however a plan
   *  stands. */
  .procedure("selectMigrationRoute")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupSelectMigrationRoute(input, administratorOf(actor)))

  .procedure("rename")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupRename(input, administratorOf(actor)))

  .procedure("setArrivals")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupSetArrivals(input, administratorOf(actor)))

  .procedure("discardConnection")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupDiscardConnection(input, administratorOf(actor)))

  .procedure("removeConnection")
  .withPermission("sso:manage")
  .handle(({ app, input, actor }) => app.setupRemoveConnection(input, administratorOf(actor)))
  .build();
