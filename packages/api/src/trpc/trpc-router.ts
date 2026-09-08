/**
 * The server half of a tRPC contract: a permission and a handler bound to a
 * procedure the contract already named.
 * Design: packages/api/adrs/20260908-transport-declaration-split.md.
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

// Nothing the contract said is repeated here. `.procedure(name)` selects a
// declared member and inherits its kind, its parser and its answer, so the
// name, the schemas and the browser's cache key have one source.

// The declaration carries no process generic and no runtime import.
// `router(runtime, app)` is where the host's root, ports and application slice
// arrive: the runtime builds each procedure on the one execution path, and the
// declaration only says which members there are and what each one does.

import type {
  AuthzDeclaration,
  AuthzPermission,
  EnforcedScopeFields,
} from "@langwatch/authz-contract";
import type { FeatureApiToken } from "@langwatch/runtime-composition/contract";
import type {
  AnyTRPCRootTypes,
  TRPCBuiltRouter,
  TRPCDecorateCreateRouterOptions,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
  TRPCSubscriptionProcedure,
} from "@trpc/server";
import type { z } from "zod";

import type { AccessDeclaration } from "../access/access.ts";
import type { TrpcContract, TrpcContractMember } from "../contract/trpc-contract.ts";
import type { ApiHandlerArguments } from "../handler-arguments.ts";
import type { TrpcHandlerActor } from "./trpc-handler.ts";

/** A feature API token is the runtime identity a router binds to. */
export type TrpcFeatureApiWitness<Api> = FeatureApiToken<Api>;

/** What a governed handler is handed. There is no `ctx`, request or response. */
export type TrpcContractHandlerArguments<Input, App> = Omit<
  ApiHandlerArguments<Input, App>,
  "actor"
> &
  Readonly<{ actor: TrpcHandlerActor }>;

type ValueResult<Output extends z.ZodType> = z.input<Output> | Promise<z.input<Output>>;
type StreamResult<Output extends z.ZodType> =
  | AsyncIterable<z.input<Output>>
  | Promise<AsyncIterable<z.input<Output>>>;

/** What a handler may answer: the declared output, one stream value, or nothing. */
type MemberResult<Member extends TrpcContractMember> =
  Member extends TrpcContractMember<infer Kind, z.ZodType, infer Output>
    ? Output extends z.ZodType
      ? Kind extends "subscription"
        ? StreamResult<Output>
        : ValueResult<Output>
      : void | Promise<void>
    : never;

/** Names the procedures `build()` is still waiting for. */
export type TrpcProceduresNotImplemented<Names extends string> = Readonly<{
  readonly procedureNotImplemented: Names;
}>;

/** What the CLIENT sends, and what it receives — the declaration's own two sides. */
type MemberOutput<Member extends TrpcContractMember> =
  Member extends TrpcContractMember<infer Kind, z.ZodType, infer Output>
    ? Output extends z.ZodType
      ? Kind extends "subscription"
        ? AsyncIterable<z.output<Output>>
        : z.output<Output>
      : void
    : never;

type MemberDefinition<Member extends TrpcContractMember> = {
  input: z.input<Member["input"]>;
  output: MemberOutput<Member>;
  meta: object;
};

type MemberProcedure<Member extends TrpcContractMember> = Member["kind"] extends "query"
  ? TRPCQueryProcedure<MemberDefinition<Member>>
  : Member["kind"] extends "mutation"
    ? TRPCMutationProcedure<MemberDefinition<Member>>
    : TRPCSubscriptionProcedure<MemberDefinition<Member>>;

/** The record the mounted router publishes, derived from the declaration alone. */
export type TrpcContractProcedures<Contract extends TrpcContract> = {
  [Name in keyof Contract["members"]]: MemberProcedure<Contract["members"][Name]>;
};

/**
 * One member as the runtime is asked to build it: the contract's parser and
 * answer, the server's access decision, its handler, and where the
 * application slice comes from.
 */
export type TrpcProcedureRequest<TContext extends object> = Readonly<{
  /** The dotted name an output refusal and an audit row are written with. */
  procedure: string;
  member: TrpcContractMember;
  access: AccessDeclaration;
  handle(args: never): unknown;
  app(ctx: TContext): unknown;
}>;

/**
 * What a runtime offers a declaration: one built procedure per member, and the
 * root's own router factory to collect them. Named structurally so the
 * declaration stays inert — it imports no runtime and names no tRPC generic.
 */
export interface TrpcProcedureFactory<TContext extends object> {
  procedure(request: TrpcProcedureRequest<TContext>): unknown;
  router(record: Readonly<Record<string, unknown>>): unknown;
}

/** A host invokes this with its own runtime and the application slice to bind. */
export type TrpcRouterMount<Api, Contract extends TrpcContract> = <TContext extends object>(
  runtime: TrpcProcedureFactory<TContext>,
  app: (ctx: TContext) => Api,
) => TRPCBuiltRouter<
  AnyTRPCRootTypes,
  TRPCDecorateCreateRouterOptions<TrpcContractProcedures<Contract>>
>;

/** The inert declaration a feature installer retains and a process mounts. */
export type TrpcRouterDeclaration<Api, Contract extends TrpcContract> = Readonly<{
  readonly protocol: "trpc";
  readonly api: TrpcFeatureApiWitness<Api>;
  readonly namespace: Contract["namespace"];
  readonly router: TrpcRouterMount<Api, Contract>;
}>;

type Undeclared<Contract extends TrpcContract, Implemented extends string> = Exclude<
  keyof Contract["members"] & string,
  Implemented
>;

/** Select the next declared procedure, or build once every one is implemented. */
export interface TrpcRouterBuilder<Api, Contract extends TrpcContract, Implemented extends string> {
  procedure<Name extends Undeclared<Contract, Implemented>>(
    name: Name,
  ): TrpcRouterAccess<Api, Contract, Implemented, Name>;
  build(
    this: [Undeclared<Contract, Implemented>] extends [never]
      ? TrpcRouterBuilder<Api, Contract, Implemented>
      : TrpcProceduresNotImplemented<Undeclared<Contract, Implemented>>,
  ): TrpcRouterDeclaration<Api, Contract>;
}

/**
 * A selected procedure with no access decision yet, so it has no `handle` to
 * call. The three members are the AuthZ vocabulary; no role enum reaches here.
 */
export interface TrpcRouterAccess<
  Api,
  Contract extends TrpcContract,
  Implemented extends string,
  Name extends keyof Contract["members"] & string,
> {
  withPermission(
    access: AuthzPermission | AuthzDeclaration,
  ): TrpcRouterImplementation<Api, Contract, Implemented, Name>;
  /** Authenticated and deliberately unchecked, with the reason it needs none. */
  noPermission(declaration: {
    reason: string;
    allow?: Record<string, string>;
  }): TrpcRouterImplementation<Api, Contract, Implemented, Name>;
  /** The handler proves standing itself; `enforces` records which fields it covers. */
  serviceAuthorized(declaration: {
    reason: string;
    permissions: readonly AuthzPermission[];
    enforces?: EnforcedScopeFields;
  }): TrpcRouterImplementation<Api, Contract, Implemented, Name>;
}

/** The handler, over the contract's parsed input and declared answer. */
export interface TrpcRouterImplementation<
  Api,
  Contract extends TrpcContract,
  Implemented extends string,
  Name extends keyof Contract["members"] & string,
> {
  handle(
    handler: (
      args: TrpcContractHandlerArguments<z.output<Contract["members"][Name]["input"]>, Api>,
    ) => MemberResult<Contract["members"][Name]>,
  ): TrpcRouterBuilder<Api, Contract, Implemented | Name>;
}

type Implementation = Readonly<{
  access: AccessDeclaration;
  handle(args: never): unknown;
}>;

function mountRouter<Api, Contract extends TrpcContract>(
  contract: Contract,
  implementations: ReadonlyMap<string, Implementation>,
): TrpcRouterMount<Api, Contract> {
  return <TContext extends object>(
    runtime: TrpcProcedureFactory<TContext>,
    app: (ctx: TContext) => Api,
  ) => {
    const record: Record<string, unknown> = {};

    for (const [name, member] of Object.entries(contract.members)) {
      const implementation = implementations.get(name);

      if (!implementation) {
        throw new Error(
          `tRPC router "${contract.namespace}" has no implementation for procedure "${name}"`,
        );
      }

      record[name] = runtime.procedure({
        procedure: `${contract.namespace}.${name}`,
        member,
        access: implementation.access,
        handle: implementation.handle,
        app,
      });
    }

    return runtime.router(record) as TRPCBuiltRouter<
      AnyTRPCRootTypes,
      TRPCDecorateCreateRouterOptions<TrpcContractProcedures<Contract>>
    >;
  };
}

function routerBuilder<Api, Contract extends TrpcContract, Implemented extends string>(
  api: TrpcFeatureApiWitness<Api>,
  contract: Contract,
  implementations: ReadonlyMap<string, Implementation>,
): TrpcRouterBuilder<Api, Contract, Implemented> {
  const implement = (name: string) => (access: AuthzPermission | AuthzDeclaration) => ({
    handle: (handle: (args: never) => unknown) =>
      routerBuilder(
        api,
        contract,
        new Map(implementations).set(name, { access: accessDeclarationOf(access), handle }),
      ),
  });

  return {
    procedure: (name: string) => {
      assertDeclared(contract, name);
      assertUnimplemented(contract, name, implementations);
      const access = implement(name);

      return {
        withPermission: access,
        noPermission: (declaration: { reason: string; allow?: Record<string, string> }) =>
          access({
            kind: "no-permission",
            reason: declaration.reason,
            allow: declaration.allow ? { ...declaration.allow } : undefined,
          }),
        serviceAuthorized: (declaration: {
          reason: string;
          permissions: readonly AuthzPermission[];
          enforces?: EnforcedScopeFields;
        }) =>
          access({
            kind: "service-authorized",
            reason: declaration.reason,
            permissions: declaration.permissions,
            ...(declaration.enforces === undefined ? {} : { enforces: declaration.enforces }),
          }),
      };
    },
    build: () => ({
      protocol: "trpc",
      api,
      namespace: contract.namespace,
      router: mountRouter<Api, Contract>(contract, implementations),
    }),
  } as TrpcRouterBuilder<Api, Contract, Implemented>;
}

/**
 * A bare permission is the one-permission declaration spelled short. `custom`
 * is refused: a custom check IS its own middleware, and the one execution path
 * has no seam for one.
 */
function accessDeclarationOf(access: AuthzPermission | AuthzDeclaration): AccessDeclaration {
  if (typeof access === "string") return { kind: "permission", permission: access };

  if (access.kind === "custom") {
    throw new Error("a tRPC router cannot declare a custom access check");
  }

  return access;
}

function assertDeclared(contract: TrpcContract, name: string): void {
  if (!(name in contract.members)) {
    throw new Error(`tRPC contract "${contract.namespace}" declares no procedure "${name}"`);
  }
}

function assertUnimplemented(
  contract: TrpcContract,
  name: string,
  implementations: ReadonlyMap<string, Implementation>,
): void {
  if (implementations.has(name)) {
    throw new Error(`tRPC router "${contract.namespace}" implements procedure "${name}" twice`);
  }
}

/**
 * Opens the server side of one declared namespace. Every procedure the
 * contract names must be implemented exactly once before `build()` compiles.
 */
export function defineTrpcRouter<Api, Contract extends TrpcContract>(
  api: TrpcFeatureApiWitness<Api>,
  contract: Contract,
): TrpcRouterBuilder<Api, Contract, never> {
  return routerBuilder(api, contract, new Map());
}
