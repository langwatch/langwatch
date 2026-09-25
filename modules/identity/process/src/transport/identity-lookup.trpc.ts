/**
 * The server half of `identityLookup.*` (D05): gated on the ADMIN_EMAILS staff
 * list by the application, never an RBAC permission, and refused as a 404.
 */
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import {
  type IdentityLookupOperator,
  IdentityLookupApi,
  identityLookupTrpc,
} from "@langwatch/identity-contract";
import { opsOperatorSchema, type OpsOperator } from "@langwatch/ops-contract";

/** The signed-in operator, bound by the process under the name ops reads it by. */
const operatorFact = defineTrpcFact("opsOperator", opsOperatorSchema.nullable());

const NO_PERMISSION = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-organization by design",
} as const;

const NO_PERMISSION_FOR_ORGANIZATION = {
  ...NO_PERMISSION,
  allow: {
    organizationId:
      "names the tenant whose invitation the command touches; the caller's reach is the ADMIN_EMAILS staff list and is never derived from this id",
  },
} as const;

/** Whoever asked: the impersonator when there is one, since "acting as" is not who looked. */
function operatorOf(fact: OpsOperator | null, actor: { id: string }): IdentityLookupOperator {
  return { userId: fact?.impersonator?.id ?? actor.id };
}

export const identityLookupTrpcTransport = defineTrpcRouter(IdentityLookupApi, identityLookupTrpc)
  .procedure("resolve")
  .withFacts(operatorFact)
  .noPermission(NO_PERMISSION)
  .handle(({ app, input, actor }, operator) =>
    app.lookupAddress({ address: input.address, operator: operatorOf(operator, actor) }),
  )

  .procedure("person")
  .withFacts(operatorFact)
  .noPermission(NO_PERMISSION)
  .handle(({ app, input, actor }, operator) =>
    app.getLookupPerson({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("recentActivity")
  .withFacts(operatorFact)
  .noPermission(NO_PERMISSION)
  .handle(({ app, actor }, operator) =>
    app.findLookupActivity({ operator: operatorOf(operator, actor) }),
  )

  .procedure("claimQueue")
  .withFacts(operatorFact)
  .noPermission(NO_PERMISSION)
  .handle(({ app, actor }, operator) =>
    app.findDomainClaimQueue({ operator: operatorOf(operator, actor) }),
  )

  .procedure("detachMethod")
  .withFacts(operatorFact)
  .noPermission(NO_PERMISSION)
  .handle(({ app, input, actor }, operator) =>
    app.detachLookupMethod({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("endSessions")
  .withFacts(operatorFact)
  .noPermission(NO_PERMISSION)
  .handle(({ app, input, actor }, operator) =>
    app.endLookupSessions({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("resendInvitation")
  .withFacts(operatorFact)
  .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
  .handle(({ app, input, actor }, operator) =>
    app.resendLookupInvitation({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("extendInvitation")
  .withFacts(operatorFact)
  .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
  .handle(({ app, input, actor }, operator) =>
    app.extendLookupInvitation({ ...input, operator: operatorOf(operator, actor) }),
  )
  .build();
