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
import { defineTrpcRouter, type TrpcHandlerActor } from "@langwatch/api/trpc";
import { SsoApi, ssoConnectionTrpc, type SsoOperator } from "@langwatch/enterprise-sso-contract";

/**
 * The written record of what decides the caller's reach: the ADMIN_EMAILS
 * staff list plus the application's own `isAdmin`, deliberately not `ops:*`.
 * `ops` is the registry's only platform-scope resource, and if it ever widens
 * to a broader operator population, who may attest a customer's domain must
 * not widen with it by accident.
 */
const STAFF_LIST_REASON =
  "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design";

/**
 * The id is NOT what decides the caller's reach. An operator on the staff list
 * may act on any organization and one who is not may act on none, so
 * `organizationId` is routing.
 */
const ORGANIZATION_IS_ROUTING = {
  organizationId:
    "names the tenant whose connection history the command appends to; the caller's reach is the ADMIN_EMAILS staff list and is never derived from this id",
} as const;

/** The impersonator where there is one: debugging a customer stays operator work. */
function operatorOf(actor: TrpcHandlerActor): SsoOperator {
  if (actor.type === "user" && actor.impersonatorId !== undefined) {
    return { id: actor.id, impersonatorId: actor.impersonatorId };
  }

  return { id: actor.id };
}

export const ssoConnectionTrpcTransport = defineTrpcRouter(SsoApi, ssoConnectionTrpc)
  .procedure("getAll")
  .noPermission({ reason: STAFF_LIST_REASON })
  .handle(({ app, input, actor }) => app.listConnections(input, operatorOf(actor)))

  .procedure("getById")
  .noPermission({ reason: STAFF_LIST_REASON })
  .handle(
    async ({ app, input, actor }) => (await app.findConnection(input, operatorOf(actor))) ?? null,
  )

  .procedure("register")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.registerConnection(input, operatorOf(actor)))

  .procedure("claimDomain")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.claimDomain(input, operatorOf(actor)))

  .procedure("approveDomainClaim")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.approveDomainClaim(input, operatorOf(actor)))

  .procedure("rejectDomainClaim")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.rejectDomainClaim(input, operatorOf(actor)))

  .procedure("attestDomain")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.attestDomain(input, operatorOf(actor)))

  .procedure("activate")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.activateConnection(input, operatorOf(actor)))

  .procedure("suspend")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.suspendConnection(input, operatorOf(actor)))

  .procedure("resume")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.resumeConnection(input, operatorOf(actor)))

  .procedure("requestTeardown")
  .noPermission({ reason: STAFF_LIST_REASON, allow: ORGANIZATION_IS_ROUTING })
  .handle(({ app, input, actor }) => app.requestTeardown(input, operatorOf(actor)))
  .build();
