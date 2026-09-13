/**
 * Several built routers, one namespace claim.
 *
 * A namespace whose surface outgrows one declaration chain is declared in
 * fragments — the fluent builder's generics are recursive, and a chain of
 * roughly fifty procedures is where TypeScript gives up on it — but a process
 * mounts ONE declaration per namespace, and two claims on the same name are
 * refused by the mount. Composition is what closes that gap: it takes the
 * fragments as they were BUILT and answers one declaration, so no fragment
 * re-enters the builder's recursive chain and the namespace is claimed once.
 *
 * The merge happens where the fragments already meet: each one is built on the
 * SAME runtime and the same application slice this mount was handed, and its
 * procedures are collected into one record which that runtime's own `router`
 * closes over. So the composed router is a router of the process's own root,
 * indistinguishable from the one a single contract of every procedure would
 * have produced — the fragments are a declaration-time convenience and reach
 * the wire as one flat namespace.
 */
import type {
  AnyTRPCRootTypes,
  TRPCBuiltRouter,
  TRPCDecorateCreateRouterOptions,
} from "@trpc/server";

import type {
  TrpcContract,
  TrpcContractMember,
  TrpcContractMembers,
} from "../contract/trpc-contract.ts";
import type {
  TrpcContractProcedures,
  TrpcFeatureApiWitness,
  TrpcProcedureFactory,
  TrpcProcedureRequest,
  TrpcRouterDeclaration,
} from "./runtime.ts";

/**
 * One fragment, as composition reads it: what it declares, and how it mounts.
 * Named structurally, so a declaration built for its own contract composes
 * without composition naming that contract. Neither the application nor the
 * contract appears as a parameter here: an api token is invariant in the
 * application it names, and the mount is contravariant in it, so a type that
 * asked for both would only ever match a declaration it already knew. Both are
 * read back off the fragments instead, by inference.
 */
export type ComposableTrpcRouter<Namespace extends string = string> = Readonly<{
  readonly protocol: "trpc";
  readonly api: object;
  readonly namespace: Namespace;
  readonly contract: TrpcContract<Namespace>;
  readonly router: <TContext extends object>(
    runtime: TrpcProcedureFactory<TContext>,
    app: (ctx: TContext) => never,
  ) => unknown;
}>;

/** The application one fragment binds to. */
type ApiOf<Declaration> = Declaration extends {
  readonly api: TrpcFeatureApiWitness<infer Api>;
}
  ? Api
  : never;

/**
 * The one application every fragment binds to. Composition refuses fragments
 * that bind to two, so the intersection is how the type says the application
 * the mount supplies has to answer for all of them.
 */
type ComposedApi<Api> = (Api extends unknown ? (api: Api) => void : never) extends (
  api: infer Merged,
) => void
  ? Merged
  : never;

/** What one fragment declares. */
type MembersOf<Declaration> = Declaration extends {
  readonly contract: TrpcContract<string, infer Members extends TrpcContractMembers>;
}
  ? Members
  : never;

/**
 * Every fragment's members as one set. Written as an inference over a union of
 * function parameters — the one way to intersect a union — with the constraint
 * carried through the `infer`, so the result is still a member record and a
 * composed contract still satisfies `TrpcContract`.
 */
type MergedMembers<Members extends TrpcContractMembers> = (
  Members extends unknown ? (members: Members) => void : never
) extends (members: infer Merged extends TrpcContractMembers) => void
  ? Merged
  : never;

/** The one contract a composed declaration answers for. */
export type ComposedTrpcContract<
  Namespace extends string,
  Declarations extends readonly { readonly contract: TrpcContract }[],
> = TrpcContract<Namespace, MergedMembers<MembersOf<Declarations[number]>>>;

/**
 * Composes fragments declared under one namespace into the single declaration
 * a process mounts for it. Every fragment must name that namespace and serve
 * the same application, and no procedure name may be declared twice: a clash
 * is refused here, where both fragments are in view, rather than at the boot
 * that first mounts them or — worse — by one silently answering for the other.
 */
export function composeTrpcRouters<
  Namespace extends string,
  const Declarations extends readonly ComposableTrpcRouter<Namespace>[],
>(
  namespace: Namespace,
  declarations: Declarations,
): TrpcRouterDeclaration<
  ComposedApi<ApiOf<Declarations[number]>>,
  ComposedTrpcContract<Namespace, Declarations>
> {
  const fragments: readonly ComposableTrpcRouter<Namespace>[] = [...declarations];
  const first = fragments[0];

  if (!first) {
    throw new Error(`tRPC namespace "${namespace}" is composed from no routers at all`);
  }

  for (const fragment of fragments) {
    if (fragment.namespace !== namespace) {
      throw new Error(
        `tRPC namespace "${namespace}" is composed from a router declared under "${fragment.namespace}"`,
      );
    }

    if (fragment.api !== first.api) {
      throw new Error(
        `tRPC namespace "${namespace}" is composed from routers that serve two different applications`,
      );
    }
  }

  const members = composedMembers(namespace, fragments);

  const composed = {
    protocol: "trpc",
    api: first.api,
    namespace,
    contract: Object.freeze({ namespace, members: Object.freeze(members) }),
    router: composedMount(namespace, fragments),
  };

  // The record was assembled from the fragments' own members, which is exactly
  // what `ComposedTrpcContract` describes; nothing but the compiler can carry
  // that correspondence across the loop that built it.
  return Object.freeze(composed) as unknown as TrpcRouterDeclaration<
    ComposedApi<ApiOf<Declarations[number]>>,
    ComposedTrpcContract<Namespace, Declarations>
  >;
}

/** Every fragment's members, with a name declared twice refused by both names. */
function composedMembers(
  namespace: string,
  fragments: readonly { readonly contract: TrpcContract }[],
): Record<string, TrpcContractMember> {
  const members: Record<string, TrpcContractMember> = {};

  for (const fragment of fragments) {
    for (const [name, member] of Object.entries(fragment.contract.members)) {
      if (name in members) {
        throw new Error(
          `tRPC namespace "${namespace}" is composed from two routers that both declare procedure "${name}"`,
        );
      }

      members[name] = member;
    }
  }

  return members;
}

/**
 * The composed mount. Each fragment is built on a runtime that is this mount's
 * own in every respect but one: asked for a router, it answers the record it
 * was handed, so the procedures arrive here rather than in a router of their
 * own. The process's real `router` is called once, over all of them.
 */
function composedMount<Namespace extends string>(
  namespace: Namespace,
  fragments: readonly ComposableTrpcRouter<Namespace>[],
) {
  return <TContext extends object>(
    runtime: TrpcProcedureFactory<TContext>,
    app: (ctx: TContext) => never,
  ) => {
    const record: Record<string, unknown> = {};

    for (const fragment of fragments) {
      const collecting: TrpcProcedureFactory<TContext> = {
        procedure: (request: TrpcProcedureRequest<TContext>) => runtime.procedure(request),
        router: (built) => built,
      };

      const built = fragment.router(collecting, app);

      if (typeof built !== "object" || built === null) {
        throw new Error(
          `tRPC namespace "${namespace}" is composed from a router that built no procedures`,
        );
      }

      for (const [name, procedure] of Object.entries(built)) {
        if (name in record) {
          throw new Error(
            `tRPC namespace "${namespace}" is composed from two routers that both bound procedure "${name}"`,
          );
        }

        record[name] = procedure;
      }
    }

    return runtime.router(record) as TRPCBuiltRouter<
      AnyTRPCRootTypes,
      TRPCDecorateCreateRouterOptions<TrpcContractProcedures<TrpcContract>>
    >;
  };
}
