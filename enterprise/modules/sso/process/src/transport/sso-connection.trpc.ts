// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `ssoConnections.*`: an access declaration and a handler
 * per procedure the contract already named.
 *
 * tRPC rather than the flat REST admin API for one reason: every change to a
 * connection is a guarded command with the operator recorded on it, and the
 * REST surface writes table rows. No shape of that surface could carry a
 * lifecycle verb.
 *
 * Spec: specs/identity/sso-onboarding-tiers.feature.
 */
import {
  defineTrpcRouter,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import { SsoApi, ssoConnectionTrpc, type SsoOperator } from "@langwatch/enterprise-sso-contract";

/**
 * The door asks ops:manage at the platform tier, never an org permission, so no org role
 * widens who may attest a domain; it refuses while impersonating, always as a not-found.
 */
const OPERATOR_PERMISSION = "ops:manage";
const OPERATOR_SCOPE = { at: "platform", refusal: "hidden" } as const;

/** The impersonator where there is one, so the audit names the operator. */
function operatorOf(actor: TrpcHandlerActor): SsoOperator {
  if (actor.type === "user" && actor.impersonatorId !== undefined) {
    return { id: actor.id, impersonatorId: actor.impersonatorId };
  }

  return { id: actor.id };
}

export const ssoConnectionTrpcTransport: TrpcRouterDeclaration<SsoApi, typeof ssoConnectionTrpc> =
  defineTrpcRouter(SsoApi, ssoConnectionTrpc)
    .procedure("getAll")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.listConnections(input, operatorOf(actor)))

    .procedure("getById")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(
      async ({ app, input, actor }) => (await app.findConnection(input, operatorOf(actor))) ?? null,
    )

    .procedure("getHistory")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(
      async ({ app, input, actor }) =>
        (await app.findConnectionHistoryForOperator(input, operatorOf(actor))) ?? null,
    )

    .procedure("getMigrationProgress")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(
      async ({ app, input, actor }) =>
        (await app.getMigrationProgressForOperator(input, operatorOf(actor))).migration,
    )

    .procedure("startLegacyMigration")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) =>
      app.startLegacyMigrationForOperator(input, operatorOf(actor)),
    )

    .procedure("register")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.registerConnection(input, operatorOf(actor)))

    .procedure("claimDomain")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.claimDomain(input, operatorOf(actor)))

    .procedure("approveDomainClaim")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.approveDomainClaim(input, operatorOf(actor)))

    .procedure("rejectDomainClaim")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.rejectDomainClaim(input, operatorOf(actor)))

    .procedure("attestDomain")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.attestDomain(input, operatorOf(actor)))

    .procedure("activate")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.activateConnection(input, operatorOf(actor)))

    .procedure("suspend")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.suspendConnection(input, operatorOf(actor)))

    .procedure("resume")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.resumeConnection(input, operatorOf(actor)))

    .procedure("requestTeardown")
    .withPermission(OPERATOR_PERMISSION, OPERATOR_SCOPE)
    .handle(({ app, input, actor }) => app.requestTeardown(input, operatorOf(actor)))
    .build();
