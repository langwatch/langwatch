/**
 * The server half of `identityLookup.*` (D05): the door admits ops:manage at the
 * platform and hides the surface (404) from everyone else; a refused caller is
 * recorded through onRefused, within the stranger budget (Q51).
 */
import { defineTrpcFact, defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  type IdentityLookupOperator,
  IdentityLookupApi,
  identityLookupTrpc,
  normalizeIdentifierValue,
} from "@langwatch/identity-contract";
import { opsOperatorSchema, type OpsOperator } from "@langwatch/ops-contract";

/** The signed-in operator, bound by the process under the name ops reads it by. */
export const operatorFact = defineTrpcFact("opsOperator", opsOperatorSchema.nullable());

/** Main's surface: only a platform operator may look or repair, and nobody else sees it. */
const OPERATOR = { at: "platform", refusal: "hidden" } as const;

/** Whoever asked: the impersonator when there is one, since "acting as" is not who looked. */
function operatorOf(fact: OpsOperator | null, actor: { id: string }): IdentityLookupOperator {
  return { userId: fact?.impersonator?.id ?? actor.id };
}

/** What the door hands onRefused: the parsed input and whoever it refused. */
type RefusedCall<Input> = Readonly<{
  app: IdentityLookupApi;
  input: Input;
  actor: Readonly<{ type: string; id?: string; impersonatorId?: string }> | null;
}>;

/** The refused attempt, recorded against whoever made it; an anonymous caller names nobody. */
function refused<Input>(
  action: string,
  argsOf: (input: Input) => Readonly<Record<string, string | null>> = () => ({}),
): (refusal: RefusedCall<Input>) => Promise<void> {
  return async ({ app, input, actor }) => {
    if (actor?.type !== "user" || actor.id === undefined) return;
    await app.recordRefusedLookup({
      operator: { userId: actor.impersonatorId ?? actor.id },
      action,
      args: argsOf(input),
    });
  };
}

export const identityLookupTrpcTransport: TrpcRouterDeclaration<
  IdentityLookupApi,
  typeof identityLookupTrpc
> = defineTrpcRouter(IdentityLookupApi, identityLookupTrpc)
  .procedure("resolve")
  .withFacts(operatorFact)
  .onRefused(
    refused("resolve", ({ address }: { address: string }) => ({
      address: normalizeIdentifierValue(address),
    })),
  )
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input, actor }, operator) =>
    app.lookupAddress({ address: input.address, operator: operatorOf(operator, actor) }),
  )

  .procedure("person")
  .withFacts(operatorFact)
  .onRefused(
    refused("person", ({ userId, address }: { userId: string; address: string }) => ({
      userId,
      address: normalizeIdentifierValue(address),
    })),
  )
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input, actor }, operator) =>
    app.getLookupPerson({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("recentActivity")
  .withFacts(operatorFact)
  .onRefused(refused("recentActivity"))
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor }, operator) =>
    app.findLookupActivity({ operator: operatorOf(operator, actor) }),
  )

  .procedure("claimQueue")
  .withFacts(operatorFact)
  .onRefused(refused("claimQueue"))
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor }, operator) =>
    app.findDomainClaimQueue({ operator: operatorOf(operator, actor) }),
  )

  .procedure("confirmProposedSignIn")
  .withFacts(operatorFact)
  .onRefused(
    refused("confirmProposedSignIn", (input: Readonly<Record<string, string | null>>) => input),
  )
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input, actor }, operator) =>
    app.confirmProposedSignIn({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("rejectProposedSignIn")
  .withFacts(operatorFact)
  .onRefused(
    refused("rejectProposedSignIn", (input: Readonly<Record<string, string | null>>) => input),
  )
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input, actor }, operator) =>
    app.rejectProposedSignIn({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("detachMethod")
  .withFacts(operatorFact)
  .onRefused(refused("detachMethod", (input: Readonly<Record<string, string | null>>) => input))
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input, actor }, operator) =>
    app.detachLookupMethod({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("endSessions")
  .withFacts(operatorFact)
  .onRefused(refused("endSessions", (input: Readonly<Record<string, string | null>>) => input))
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input, actor }, operator) =>
    app.endLookupSessions({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("resendInvitation")
  .withFacts(operatorFact)
  .onRefused(refused("resendInvitation", (input: Readonly<Record<string, string | null>>) => input))
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input, actor }, operator) =>
    app.resendLookupInvitation({ ...input, operator: operatorOf(operator, actor) }),
  )

  .procedure("extendInvitation")
  .withFacts(operatorFact)
  .onRefused(refused("extendInvitation", (input: Readonly<Record<string, string | null>>) => input))
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input, actor }, operator) =>
    app.extendLookupInvitation({ ...input, operator: operatorOf(operator, actor) }),
  )
  .build();
