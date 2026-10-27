// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `ssoSetup.*`: the organization's own administrator, where
 * `ssoConnections.*` is the back office. The history is close to an audit
 * trail of everyone who has touched the connection, so it is offered to
 * whoever could act on it rather than to every reader who may see it.
 *
 * Spec: specs/identity/sso-connection-history.feature.
 */
import {
  defineTrpcRouter,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import {
  SsoApi,
  ssoSetupMigrationRouteSchema,
  ssoSetupTrpc,
  type SsoAdministrator,
} from "@langwatch/enterprise-sso-contract";

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

/** Only moving traffic to the replacement is the paid rollout; rolling back never asks the plan. */
function selectsDirectRoute(input: unknown): boolean {
  const parsed = ssoSetupMigrationRouteSchema.safeParse(input);

  return parsed.success && parsed.data.route === "direct";
}

const SSO_PLAN = { feature: "SSO" } as const;

export const ssoSetupTrpcTransport: TrpcRouterDeclaration<SsoApi, typeof ssoSetupTrpc> =
  defineTrpcRouter(SsoApi, ssoSetupTrpc)
    .procedure("getSetup")
    .withPermission("sso:view")
    .handle(({ app, input, actor }) => app.getSetup(input, administratorOf(actor)))

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

    /** The Enterprise plan is declared and asked after access, so a caller who
     *  does not hold `sso:manage` is told that rather than told what was not bought. */
    .procedure("register")
    .withEntitlement("enterprise", SSO_PLAN)
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupRegister(input, administratorOf(actor)))

    .procedure("startLegacyMigration")
    .withEntitlement("enterprise", SSO_PLAN)
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupStartLegacyMigration(input, administratorOf(actor)))

    /** The plan gate holds only for `direct`: rolling back to the grandfathered
     *  provider stays reachable however a plan stands. */
    .procedure("selectMigrationRoute")
    .withEntitlement("enterprise", { feature: "SSO", when: selectsDirectRoute })
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupSelectMigrationRoute(input, administratorOf(actor)))

    /** Gated like the registration that opened the cutover. */
    .procedure("finalizeLegacyMigration")
    .withEntitlement("enterprise", SSO_PLAN)
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) =>
      app.setupFinalizeLegacyMigration(input, administratorOf(actor)),
    )

    .procedure("rename")
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupRename(input, administratorOf(actor)))

    /** `sso:manage`, not `sso:view`: it carries the client id, which only the
     *  person who may change it needs. Not plan-gated, it is a read. */
    .procedure("identityProvider")
    .withPermission("sso:manage")
    .handle(({ app, input }) => app.findIdentityProvider(input))

    /** Gated like `register`: these settings decide where sign-ins go. */
    .procedure("updateIdentityProvider")
    .withEntitlement("enterprise", SSO_PLAN)
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) =>
      app.setupUpdateIdentityProvider(input, administratorOf(actor)),
    )

    .procedure("setArrivals")
    .withEntitlement("enterprise", SSO_PLAN)
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupSetArrivals(input, administratorOf(actor)))

    /** Gated like registration: turning it on is the same purchase. */
    .procedure("activate")
    .withEntitlement("enterprise", SSO_PLAN)
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupActivate(input, administratorOf(actor)))

    /**
     * `sso:view`, deliberately below the rest: who can still get in without the
     * identity provider is what a security reviewer reads this page for. Not
     * plan-gated anywhere in this block — a lapsed plan must never close the
     * way back in.
     */
    .procedure("breakGlassBindings")
    .withPermission("sso:view")
    .handle(({ app, input }) => app.findBreakGlassGrants(input))

    /** `sso:manage`: the administrators with their addresses, which only
     *  somebody who can actually grant one needs. */
    .procedure("breakGlassCandidates")
    .withPermission("sso:manage")
    .handle(({ app, input }) => app.findBreakGlassCandidates(input))

    .procedure("grantBreakGlass")
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupGrantBreakGlass(input, administratorOf(actor)))

    .procedure("renewBreakGlass")
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupRenewBreakGlass(input, administratorOf(actor)))

    .procedure("revokeBreakGlass")
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupRevokeBreakGlass(input, administratorOf(actor)))

    .procedure("discardConnection")
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupDiscardConnection(input, administratorOf(actor)))

    .procedure("removeConnection")
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) => app.setupRemoveConnection(input, administratorOf(actor)))
    .build();
