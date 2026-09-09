/**
 * The tRPC transport: the typed root, the process handler binding, the server
 * half of a contract (`defineTrpcRouter`), the one execution path a mounted
 * procedure runs, and the wire shape a failed call arrives in.
 */
import { actorSchema, toLedgerActor, type Actor } from "@langwatch/actor";
import {
  declaredScopeIdSchema,
  type AuthzDeclaration,
  type AuthzDeclaredScopeId,
  type AuthzPermission,
  type EnforcedScopeFields,
  type ScopeTierField,
} from "@langwatch/authz-contract";
import { HandledError, isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { createLogger, validationMeta, type RequestContext } from "@langwatch/observability";
import { runWithContext } from "@langwatch/observability/context";
import type { FeatureApiToken } from "@langwatch/runtime-composition";
import { nowInstant } from "@langwatch/time";
import {
  context as otelContext,
  trace as otelTrace,
  type Span,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import {
  initTRPC,
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCBuiltRouter,
  type TRPCDecorateCreateRouterOptions,
  type TRPCDefaultErrorShape,
  type TRPCMutationProcedure,
  type TRPCQueryProcedure,
  type TRPCRootObject,
  type TRPCRouterRecord,
  type TRPCRuntimeConfigOptions,
  type TRPCSubscriptionProcedure,
} from "@trpc/server";
import type {
  GetRawInputFn,
  MiddlewareResult,
  ProcedureType,
} from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import {
  AuthenticationRequiredError,
  decide,
  decideEntitlement,
  declareAccessMiddleware,
  SCOPE_INPUT_FIELDS,
  sharedGrantTiers,
  type AccessDeclaration,
  type AccessDenialPort,
  type ApiEntitlement,
  type AuthorizePort,
  type Caller,
  type EntitlementsPort,
  type PublicRouteAccess,
} from "../access/access.ts";
import type { TrpcContract, TrpcContractMember } from "../contract/trpc-contract.ts";
import type { ApiHandlerArguments } from "../handler-arguments.ts";
import {
  auditScopeIds,
  callerTraceContext,
  deriveAuditTarget,
  isSilencedCall,
  recordTrpcCall,
  trpcFailureTraceIds,
  type TrpcFailureTraceIds,
} from "./audit.ts";

const logger = createLogger("langwatch:trpc");
const outputLogger = createLogger("langwatch:api:output-validation");

// ─────────────────────────────────────────────────────────────────────────────
// The typed root.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Defines one typed tRPC root without choosing authentication, authorization,
 * audit, tracing, or error policy. A process constructs the root and then
 * builds the policy spine on it, supplying the concrete identity,
 * authorization, audit, error-reporting and cause-translation ports.
 */
export type TrpcRoot<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object> = TRPCRuntimeConfigOptions<
    TContext,
    object
  >,
> = Pick<
  TRPCRootObject<TContext, object, TOptions, AnyTRPCRootTypes>,
  "procedure" | "router" | "middleware"
>;

/**
 * The one place `initTRPC` is called. Feature packages ask for a root here
 * rather than initializing tRPC themselves, so every root in the process
 * carries the same context discipline.
 *
 * The builder is answered as tRPC hands it over, un-narrowed, and `create` is
 * called on it directly. A wrapper `create` of our own cannot forward the
 * options object without erasing it: `TRPCBuilder.create` derives the root's
 * `errorShape` and `transformer` from the literal type of the options it is
 * given, and a forwarding method can only pass a type parameter, which the
 * inference reads as `never`.
 */
export class TrpcRootDefinition {
  private constructor() {}

  static forContext<TContext extends object>() {
    return initTRPC.context<TContext>();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The process handler binding: how a mount resolves the application slice, the
// actor and the scope a governed handler is trusted with.
// ─────────────────────────────────────────────────────────────────────────────

/** An authenticated tRPC actor, normalized with a stable identifier for every kind. */
export type TrpcHandlerActor = Actor & Readonly<{ id: string }>;

export type ApiHandlerAdapter<TContext, App> = <Input>(input: {
  readonly ctx: TContext;
  readonly input: Input;
  readonly signal: AbortSignal | undefined;
}) => Promise<Readonly<{ app: App; actor: unknown; scope: unknown }>>;

/** Opaque process binding installed by the API mount. */
export class TrpcHandlerBinding<TContext, App> {
  private constructor(private readonly resolver: ApiHandlerAdapter<TContext, App>) {}

  static create<TContext, App>(resolve: ApiHandlerAdapter<TContext, App>) {
    return new TrpcHandlerBinding(resolve);
  }

  static resolve<TContext, App, Input>(
    binding: TrpcHandlerBinding<TContext, App>,
    request: {
      readonly ctx: TContext;
      readonly input: Input;
      readonly signal: AbortSignal | undefined;
    },
  ) {
    return binding.resolver(request);
  }
}

export function createTrpcHandlerBinding<TContext, App>(
  resolve: ApiHandlerAdapter<TContext, App>,
): TrpcHandlerBinding<TContext, App> {
  return TrpcHandlerBinding.create(resolve);
}

export async function resolveTrustedHandlerArguments<TContext, App, Input>(
  binding: TrpcHandlerBinding<TContext, App>,
  request: {
    readonly ctx: TContext;
    readonly input: Input;
    readonly signal: AbortSignal | undefined;
  },
): Promise<Readonly<{ app: App; actor: TrpcHandlerActor; scope: AuthzDeclaredScopeId | null }>> {
  const resolved = await TrpcHandlerBinding.resolve(binding, request);
  if (resolved.actor === null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required" });
  }
  const parsedActor = actorSchema.parse(resolved.actor);
  const ledgerActor = toLedgerActor(parsedActor);
  if (ledgerActor.id === null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required" });
  }
  const actor: TrpcHandlerActor =
    parsedActor.type === "user" || parsedActor.type === "api_key"
      ? parsedActor
      : { ...parsedActor, id: ledgerActor.id };
  const scope = resolved.scope === null ? null : declaredScopeIdSchema.parse(resolved.scope);
  return {
    app: resolved.app,
    actor,
    scope,
  };
}

/** Process-owned adapter that resolves trusted values after policy has run. */
export async function parseGovernedOutput<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): Promise<z.output<TSchema>> {
  return schema.parseAsync(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Declared facts: what a procedure asks the PROCESS for beyond its own input,
// bound once at the mount. The same split REST makes — the procedure declares
// what it needs, the mount says where it comes from — so nothing a caller sends
// can stand in for a fact and no handler reaches for the request itself.
// ─────────────────────────────────────────────────────────────────────────────

/** One fact: the name a mount binds it by, and the schema its value is parsed with. */
export interface TrpcFact<Schema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly schema: Schema;
}

export function defineTrpcFact<Schema extends z.ZodType>(
  name: string,
  schema: Schema,
): TrpcFact<Schema> {
  return Object.freeze({ name, schema });
}

/** Where one fact's value comes from, as this process's mount reads it. */
export interface TrpcFactBinding<TContext = never> {
  readonly fact: TrpcFact;
  resolve(ctx: TContext): unknown | Promise<unknown>;
}

/** A mount binds request access; handlers receive only the parsed result. */
export function bindTrpcFact<Schema extends z.ZodType, TContext>(
  fact: TrpcFact<Schema>,
  resolve: (ctx: TContext) => z.input<Schema> | Promise<z.input<Schema>>,
): TrpcFactBinding<TContext> {
  return { fact, resolve };
}

/**
 * The twin of REST's `bindRestHeader`: the mount names the header, so which
 * proxy header this deployment trusts is the process's answer and not a
 * feature's. A header the request did not carry resolves to null.
 */
export function bindTrpcHeader<Schema extends z.ZodType>(
  fact: TrpcFact<Schema>,
  header: string,
): TrpcFactBinding<TrpcRuntimeContext> {
  return { fact, resolve: (ctx) => headerValue(ctx.req?.headers[header]) };
}

function headerValue(value: string | readonly string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;

  return typeof value === "string" ? value : null;
}

/**
 * The browser session row this request arrived on. A fact, not part of the
 * actor: one person on two tabs is one actor and two sessions, so "end every
 * session but this one" is a question about the request, not about who asked.
 */
export const browserSessionFact = defineTrpcFact("browserSession", z.string().nullable());

/** Where the request came from, as the process's own mount reads the address. */
export const callerAddressFact = defineTrpcFact("callerAddress", z.string().nullable());

// ─────────────────────────────────────────────────────────────────────────────
// The server half of a tRPC contract: a permission and a handler bound to a
// procedure the contract already named.
// Design: packages/api/adrs/20260908-transport-declaration-split.md.
// Spec: packages/api/specs/transport-declaration-split.feature.
//
// Nothing the contract said is repeated here. `.procedure(name)` selects a
// declared member and inherits its kind, its parser and its answer. The
// declaration carries no process generic and no runtime import: `router(runtime,
// app)` is where the host's root, ports and application slice arrive.
// ─────────────────────────────────────────────────────────────────────────────

/** A feature API token is the runtime identity a router binds to. */
export type TrpcFeatureApiWitness<Api> = FeatureApiToken<Api>;

/** What a governed handler is handed. There is no `ctx`, request or response. */
export type TrpcContractHandlerArguments<Input, App> = Omit<
  ApiHandlerArguments<Input, App>,
  "actor"
> &
  Readonly<{ actor: TrpcHandlerActor }>;

/**
 * What a procedure that runs with no caller is handed. Both halves are null
 * together, so a handler cannot read one and assume the other, and the runtime
 * builds no actor to hand it.
 */
export type TrpcAnonymousHandlerArguments<Input, App> = Omit<
  ApiHandlerArguments<Input, App>,
  "actor" | "scope"
> &
  Readonly<{ actor: null; scope: null }>;

/** Whether the procedure's declaration opens a door at all. */
type TrpcCallerKind = "authenticated" | "anonymous";

type HandlerArgumentsFor<Caller extends TrpcCallerKind, Input, App> = Caller extends "anonymous"
  ? TrpcAnonymousHandlerArguments<Input, App>
  : TrpcContractHandlerArguments<Input, App>;

/** The facts a handler is handed beside its input, in the order it declared them. */
type TrpcFactValues<Facts extends readonly TrpcFact[]> = {
  [Index in keyof Facts]: z.output<Facts[Index]["schema"]>;
};

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
  access: TrpcAccess;
  /** Present exactly when the procedure asks the tenant to hold an entitlement. */
  entitlement?: ApiEntitlement;
  /** What the procedure asks the process for; the mount binds each one. */
  facts: readonly TrpcFact[];
  handle(args: never, ...facts: never[]): unknown;
  app(ctx: TContext): unknown;
}>;

/**
 * What a procedure declares instead of a permission. `publicRoute` is REST's
 * own word for it, and means the same here: no credential is resolved, no
 * actor is built, and the handler is told so.
 */
export type TrpcAccess = AccessDeclaration | PublicRouteAccess;

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
  ): TrpcRouterAccess<Api, Contract, Implemented, Name, []>;
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
  Facts extends readonly TrpcFact[],
> {
  /**
   * What this procedure needs the process to resolve, beside its own input:
   * the address the caller reached us at, the session row it arrived on. Each
   * one is bound at the mount, and reaches the handler after its arguments.
   */
  withFacts<const Added extends readonly TrpcFact[]>(
    ...facts: Added
  ): TrpcRouterAccess<Api, Contract, Implemented, Name, [...Facts, ...Added]>;
  /**
   * What the tenant behind the call must hold beside the permission. Asked
   * after access is decided, at the scope access resolved, so a caller who may
   * not do this at all is refused before the plan is ever looked up.
   */
  withEntitlement(
    entitlement: ApiEntitlement,
  ): TrpcRouterAccess<Api, Contract, Implemented, Name, Facts>;
  withPermission(
    access: AuthzPermission | AuthzDeclaration,
  ): TrpcRouterImplementation<Api, Contract, Implemented, Name, Facts, "authenticated">;
  /**
   * Every one of them, asked before the handler at the one scope the input
   * names. Naming an array is what says AND; a single permission is declared
   * on its own.
   */
  withPermission(
    permissions: readonly [AuthzPermission, AuthzPermission, ...AuthzPermission[]],
    options?: { via: ScopeTierField },
  ): TrpcRouterImplementation<Api, Contract, Implemented, Name, Facts, "authenticated">;
  /**
   * Runs with no caller at all: the sign-up that predates the account it
   * creates. `publicRoute({ reason })` is the same declaration REST writes,
   * and the reason is what a reviewer reads.
   */
  withAccess(
    access: PublicRouteAccess,
  ): TrpcRouterImplementation<Api, Contract, Implemented, Name, Facts, "anonymous">;
  /** Authenticated and deliberately unchecked, with the reason it needs none. */
  noPermission(declaration: {
    reason: string;
    allow?: Record<string, string>;
  }): TrpcRouterImplementation<Api, Contract, Implemented, Name, Facts, "authenticated">;
  /** The handler proves standing itself; `enforces` records which fields it covers. */
  serviceAuthorized(declaration: {
    reason: string;
    permissions: readonly AuthzPermission[];
    enforces?: EnforcedScopeFields;
  }): TrpcRouterImplementation<Api, Contract, Implemented, Name, Facts, "authenticated">;
}

/** The handler, over the contract's parsed input and declared answer. */
export interface TrpcRouterImplementation<
  Api,
  Contract extends TrpcContract,
  Implemented extends string,
  Name extends keyof Contract["members"] & string,
  Facts extends readonly TrpcFact[] = [],
  Caller extends TrpcCallerKind = "authenticated",
> {
  handle(
    handler: (
      args: HandlerArgumentsFor<Caller, z.output<Contract["members"][Name]["input"]>, Api>,
      ...facts: TrpcFactValues<Facts>
    ) => MemberResult<Contract["members"][Name]>,
  ): TrpcRouterBuilder<Api, Contract, Implemented | Name>;
}

type Implementation = Readonly<{
  access: TrpcAccess;
  entitlement?: ApiEntitlement;
  facts: readonly TrpcFact[];
  handle(args: never, ...facts: never[]): unknown;
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
        ...(implementation.entitlement ? { entitlement: implementation.entitlement } : {}),
        facts: implementation.facts,
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

type PermissionArgument = AuthzPermission | AuthzDeclaration | readonly AuthzPermission[];

function routerBuilder<Api, Contract extends TrpcContract, Implemented extends string>(
  api: TrpcFeatureApiWitness<Api>,
  contract: Contract,
  implementations: ReadonlyMap<string, Implementation>,
): TrpcRouterBuilder<Api, Contract, Implemented> {
  /** One selected procedure, with the facts it has named so far. */
  const selected = (name: string, facts: readonly TrpcFact[], entitlement?: ApiEntitlement) => {
    const implement = (access: TrpcAccess) => ({
      handle: (handle: (args: never, ...values: never[]) => unknown) =>
        routerBuilder(
          api,
          contract,
          new Map(implementations).set(name, {
            access,
            facts,
            handle,
            ...(entitlement ? { entitlement } : {}),
          }),
        ),
    });

    return {
      withFacts: (...added: readonly TrpcFact[]) => {
        assertFactsDistinct({ contract, name, facts: [...facts, ...added] });

        return selected(name, [...facts, ...added], entitlement);
      },
      withEntitlement: (named: ApiEntitlement) => {
        if (entitlement) {
          throw new Error(
            `tRPC ${contract.namespace}.${name} already asks whether its tenant holds ` +
              `"${entitlement}"`,
          );
        }

        return selected(name, facts, named);
      },
      withPermission: (access: PermissionArgument, options?: { via: ScopeTierField }) =>
        implement(permissionDeclarationOf({ contract, name, access, via: options?.via })),
      withAccess: (access: PublicRouteAccess) => {
        // Both ask a question about a tenant, and a public procedure has none.
        if (entitlement) {
          throw new Error(
            `tRPC ${contract.namespace}.${name} runs with no caller, so there is no tenant to ` +
              `ask whether it holds "${entitlement}"`,
          );
        }

        assertAnonymousProcedure({ contract, name });

        return implement(access);
      },
      noPermission: (declaration: { reason: string; allow?: Record<string, string> }) =>
        implement({
          kind: "no-permission",
          reason: declaration.reason,
          allow: declaration.allow ? { ...declaration.allow } : undefined,
        }),
      serviceAuthorized: (declaration: {
        reason: string;
        permissions: readonly AuthzPermission[];
        enforces?: EnforcedScopeFields;
      }) =>
        implement({
          kind: "service-authorized",
          reason: declaration.reason,
          permissions: declaration.permissions,
          ...(declaration.enforces === undefined ? {} : { enforces: declaration.enforces }),
        }),
    };
  };

  return {
    procedure: (name: string) => {
      assertDeclared(contract, name);
      assertUnimplemented(contract, name, implementations);

      return selected(name, []);
    },
    build: () => ({
      protocol: "trpc",
      api,
      namespace: contract.namespace,
      router: mountRouter<Api, Contract>(contract, implementations),
    }),
  } as TrpcRouterBuilder<Api, Contract, Implemented>;
}

function isPermissionList(access: PermissionArgument): access is readonly AuthzPermission[] {
  return Array.isArray(access);
}

/**
 * A bare permission is the one-permission declaration spelled short, an array
 * is the AND. `custom` is refused: a custom check IS its own middleware, and
 * the one execution path has no seam for one.
 */
function permissionDeclarationOf({
  contract,
  name,
  access,
  via,
}: {
  contract: TrpcContract;
  name: string;
  access: PermissionArgument;
  via?: ScopeTierField;
}): AccessDeclaration {
  if (typeof access === "string") return { kind: "permission", permission: access };

  if (isPermissionList(access)) {
    return permissionAllOf({ contract, name, permissions: access, via });
  }

  if (access.kind === "custom") {
    throw new Error("a tRPC router cannot declare a custom access check");
  }

  if (access.kind === "public") {
    throw new Error("a tRPC router declares a public procedure with withAccess(publicRoute(…))");
  }

  // An AND written as a declaration object earns the same refusals as one
  // written as a list, so the two spellings cannot disagree.
  if (access.kind === "permission-all") {
    const target = access.via ?? via;

    return permissionAllOf({
      contract,
      name,
      permissions: access.permissions,
      ...(target ? { via: target } : {}),
    });
  }

  return access;
}

/**
 * Every one of them, at one scope. A set that names fewer than two, repeats
 * one, or shares no tier it could all be asked at is refused where it is
 * written rather than at the request that first fails on it.
 */
function permissionAllOf({
  contract,
  name,
  permissions,
  via,
}: {
  contract: TrpcContract;
  name: string;
  permissions: readonly AuthzPermission[];
  via?: ScopeTierField;
}): AccessDeclaration {
  const address = `tRPC ${contract.namespace}.${name}`;

  if (permissions.length < 2) {
    throw new Error(`${address} names ${permissions.length} permissions to check together`);
  }

  if (new Set(permissions).size !== permissions.length) {
    throw new Error(`${address} names one permission twice among the ones it checks together`);
  }

  if (sharedGrantTiers(permissions).length === 0) {
    throw new Error(
      `${address} checks ${permissions.join(" and ")} together, and no one scope grants them all`,
    );
  }

  const [first, second, ...rest] = permissions as [
    AuthzPermission,
    AuthzPermission,
    ...AuthzPermission[],
  ];

  return { kind: "permission-all", permissions: [first, second, ...rest], ...(via ? { via } : {}) };
}

/**
 * A procedure that runs with no caller may not ask a question about a tenant:
 * nothing resolved a scope for it, so a scope id in its input would be a claim
 * the runtime has no way to check. The same refusal REST makes of a public
 * route, made here against the contract's declared parser.
 */
function assertAnonymousProcedure({
  contract,
  name,
}: {
  contract: TrpcContract;
  name: string;
}): void {
  const input = contract.members[name]?.input;
  const shape = input instanceof z.ZodObject ? Object.keys(input.shape) : [];
  const scoped = SCOPE_INPUT_FIELDS.filter((field) => shape.includes(field));

  if (scoped.length > 0) {
    throw new Error(
      `tRPC ${contract.namespace}.${name} runs with no caller and its input names ${scoped.join(", ")}`,
    );
  }
}

/** Two facts of one name would reach the handler as one argument twice. */
function assertFactsDistinct({
  contract,
  name,
  facts,
}: {
  contract: TrpcContract;
  name: string;
  facts: readonly TrpcFact[];
}): void {
  const names = facts.map((fact) => fact.name);

  if (new Set(names).size !== names.length) {
    throw new Error(`tRPC ${contract.namespace}.${name} declares one fact twice`);
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// The one tRPC execution path: authenticate, parse, trace, log, decide, handle,
// check the answer, audit, respond.
//
// ORDER IS BEHAVIOUR. Everything that reads the request reads the VALIDATED
// input, so it is installed after the contract's own parser: tRPC appends its
// input middleware where `.input()` is called. A check installed ahead of the
// parser is handed `input === undefined`, reads no scope id, and audits with no
// arguments, no project and no organization. Nothing reports an error.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The transport, as the path reads it: headers for the caller's trace context
 * and the user agent, and the status the log line records. Deliberately not a
 * Node request type — the callers range from an HTTP request to a WebSocket
 * handshake to nothing at all.
 */
export type TrpcRuntimeRequest = Readonly<{
  headers: Record<string, string | string[] | undefined> & { "user-agent"?: string };
  socket?: { remoteAddress?: string };
}>;

/** The request context this path reads directly, and nothing more. */
export interface TrpcRuntimeContext {
  readonly req?: TrpcRuntimeRequest | undefined;
  readonly res?: { statusCode?: number } | undefined;
}

/** One audit row, as the path describes it. */
export type TrpcRuntimeAuditEntry = Readonly<{
  userId: string;
  organizationId?: string;
  projectId?: string;
  /** The tRPC path, which is also what the redaction rules are keyed by. */
  action: string;
  args?: unknown;
  error?: Error;
  req?: TrpcRuntimeRequest;
  metadata?: Record<string, string>;
  targetKind?: string;
  targetId?: string;
}>;

/** Everything the process supplies for the path to run. */
export type TrpcRuntimePorts<TContext> = Readonly<{
  /** Who is calling, and the scope their credential resolved. */
  identity: Readonly<{ caller(ctx: TContext): Caller }>;
  /** Resolves the authorization decisions for one request. */
  authorization: Readonly<{ forRequest(ctx: TContext): AuthorizePort }>;
  /** The two refusals whose concrete error class is the process's to choose. */
  denials: AccessDenialPort;
  /** What the process reads a tenant's entitlements from, for a procedure that asks. */
  entitlements?: EntitlementsPort;
  audit: Readonly<{
    record(entry: TrpcRuntimeAuditEntry): Promise<void>;
    /** The owner says WHAT is sensitive; the path only redacts. */
    redact(input: { procedure: string; args: unknown }): unknown;
    /** The process decides which procedures it does not record. */
    exempt(procedure: string): boolean;
  }>;
  errors: Readonly<{
    report(failure: unknown): void;
    asError(failure: unknown): Error;
    /** Application classes a client interceptor acts on, by their own code. */
    translate(cause: unknown): Readonly<{ code: TRPCError["code"]; message: string }> | undefined;
  }>;
}>;

/** What one mount supplies beyond the application slice. */
export type TrpcMountOptions<TContext> = Readonly<{
  /** One binding per fact the mounted declaration's procedures name. */
  facts?: readonly TrpcFactBinding<TContext>[];
}>;

/** Mounts declared namespaces on one process's root. */
export interface TrpcRuntime<TContext extends object> extends TrpcProcedureFactory<TContext> {
  mount<Api, Contract extends TrpcContract>(
    declaration: TrpcRouterDeclaration<Api, Contract>,
    app: (ctx: TContext) => Api,
    options?: TrpcMountOptions<TContext>,
  ): TRPCBuiltRouter<
    AnyTRPCRootTypes,
    TRPCDecorateCreateRouterOptions<TrpcContractProcedures<Contract>>
  >;
}

/**
 * Builds one process's tRPC path. Called ONCE per root: every middleware it
 * installs belongs to the root that produced it.
 */
export function createTrpcRuntime<
  TContext extends TrpcRuntimeContext & object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object> = TRPCRuntimeConfigOptions<
    TContext,
    object
  >,
  TRoot extends AnyTRPCRootTypes = AnyTRPCRootTypes,
>({
  root,
  procedure,
  anonymousProcedure,
  ports,
}: {
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  /**
   * The process's AUTHENTICATED procedure. The path builds on it rather than
   * on the bare one, so a signed-out caller is refused by the process's own
   * definition of that refusal and the public-surface sweep can still tell an
   * authenticated procedure from an anonymous one.
   */
  procedure: TrpcBuildableProcedure;
  /**
   * The process's PUBLIC procedure, for a declaration that runs with no
   * caller. A runtime given none refuses such a declaration at mount, naming
   * the procedure, rather than answering it behind the authenticated door.
   */
  anonymousProcedure?: TrpcBuildableProcedure;
  ports: TrpcRuntimePorts<TContext>;
}): TrpcRuntime<TContext> {
  const trace = tracer(ports);
  const handledError = handledErrors(ports);

  const build = (
    request: TrpcProcedureRequest<TContext>,
    bound: ReadonlyMap<string, TrpcFactBinding<TContext>>,
  ): unknown => {
    const anonymous = request.access.kind === "public";
    const facts = boundFacts({ request, bound });

    // The parser FIRST, then the check: a check installed ahead of `.input()`
    // reads `undefined` and silently authorizes nothing.
    const built = doorOf({ anonymous, procedure, anonymousProcedure, request })
      .input(request.member.input)
      .use(trace)
      .use(requestLog(ports, { anonymous }))
      .use(handledError)
      .use(
        access({
          ports,
          declaration: request.access,
          procedure: request.procedure,
          app: request.app,
          facts,
          ...(request.entitlement ? { entitlement: request.entitlement } : {}),
        }),
      )
      .use(auditTrail(ports, { anonymous }));

    const handle = guardOutput({
      procedure: request.procedure,
      kind: request.member.kind,
      output: request.member.output,
      handler: request.handle,
    });

    if (request.member.kind === "query") return built.query(handle);

    if (request.member.kind === "mutation") return built.mutation(handle);

    return built.subscription(handle);
  };

  const router = (record: Readonly<Record<string, unknown>>) =>
    root.router(record as TRPCRouterRecord);

  return {
    procedure: (request) => build(request, new Map()),
    router,
    mount: (declaration, app, options) =>
      declaration.router(
        {
          procedure: (request: TrpcProcedureRequest<TContext>) =>
            build(request, factBindings(options)),
          router,
        },
        app,
      ),
  };
}

/** The bindings this mount supplied, by the fact name each one answers for. */
function factBindings<TContext>(
  options: TrpcMountOptions<TContext> | undefined,
): ReadonlyMap<string, TrpcFactBinding<TContext>> {
  return new Map((options?.facts ?? []).map((binding) => [binding.fact.name, binding] as const));
}

/**
 * Every fact the procedure declared, paired with the binding that answers it.
 * A fact the mount bound no value for is refused here, naming the fact and the
 * procedure, rather than reaching a handler as an unset argument.
 */
function boundFacts<TContext extends object>({
  request,
  bound,
}: {
  request: TrpcProcedureRequest<TContext>;
  bound: ReadonlyMap<string, TrpcFactBinding<TContext>>;
}): readonly Readonly<{ fact: TrpcFact; binding: TrpcFactBinding<TContext> }>[] {
  return request.facts.map((fact) => {
    const binding = bound.get(fact.name);

    if (!binding) {
      throw new Error(
        `tRPC ${request.procedure} declares the fact "${fact.name}", and this mount bound no value for it`,
      );
    }

    return { fact, binding };
  });
}

/**
 * Which of the process's procedures this declaration is built on. A procedure
 * that runs with no caller cannot be built on the authenticated one — the door
 * would refuse the very caller it exists to serve.
 */
function doorOf<TContext extends object>({
  anonymous,
  procedure,
  anonymousProcedure,
  request,
}: {
  anonymous: boolean;
  procedure: TrpcBuildableProcedure;
  anonymousProcedure: TrpcBuildableProcedure | undefined;
  request: TrpcProcedureRequest<TContext>;
}): TrpcBuildableProcedure {
  if (!anonymous) return procedure;

  if (anonymousProcedure) return anonymousProcedure;

  throw new Error(
    `tRPC ${request.procedure} answers with no caller, and this runtime was given no anonymous procedure to build it on`,
  );
}

/**
 * The parser-and-resolver surface a built procedure exposes, named
 * structurally at the one seam where a feature's declaration meets a builder
 * whose generics belong to the process.
 */
export type TrpcBuildableProcedure = Readonly<{
  use(middleware: unknown): TrpcBuildableProcedure;
  input(schema: z.ZodType): TrpcParsedProcedure;
}>;

/** The same builder once its parser is applied: middlewares, then a resolver. */
type TrpcParsedProcedure = Readonly<{
  use(middleware: unknown): TrpcParsedProcedure;
  query(resolver: (opts: ResolverOptions) => unknown): unknown;
  mutation(resolver: (opts: ResolverOptions) => unknown): unknown;
  subscription(resolver: (opts: ResolverOptions) => unknown): unknown;
}>;

/** What the handler is handed: no `ctx`, no request, no response. */
type HandlerArguments = Readonly<{
  app: unknown;
  input: unknown;
  actor: (Actor & { id: string }) | null;
  scope: unknown;
  signal: AbortSignal | undefined;
}>;

/**
 * What the access step establishes: the handler's own arguments, and the facts
 * it declared, resolved after the decision so a refused request never asks the
 * process for anything.
 */
type ResolvedAccess = Omit<HandlerArguments, "input" | "signal"> &
  Readonly<{ facts: readonly unknown[] }>;

/**
 * The resolver's own options. `handlerArguments` is written onto the context by
 * the access step through `next({ ctx })`, which tRPC merges onto a COPY —
 * nothing the caller passed in is mutated.
 */
type ResolverOptions = Readonly<{
  ctx: object;
  input: unknown;
  signal: AbortSignal | undefined;
}>;

/**
 * The access step: the one check, run on the validated input, writing the
 * facts the handler is handed. A procedure that ran no check cannot exist —
 * every mounted procedure carries this middleware, and it carries the
 * machine-readable declaration the router sweep reads back off it.
 */
function access<TContext extends object>({
  ports,
  declaration,
  procedure,
  entitlement,
  app,
  facts,
}: {
  ports: TrpcRuntimePorts<TContext>;
  declaration: TrpcAccess;
  procedure: string;
  entitlement?: ApiEntitlement;
  app: (ctx: TContext) => unknown;
  facts: readonly BoundFact<TContext>[];
}) {
  if (entitlement && !ports.entitlements) {
    throw new Error(
      `tRPC ${procedure} asks whether its tenant holds "${entitlement}", and this runtime ` +
        "supplied no entitlements port to ask",
    );
  }

  return declareAccessMiddleware(
    declaration,
    check({ ports, declaration, procedure, app, facts, ...(entitlement ? { entitlement } : {}) }),
  );
}

type BoundFact<TContext> = Readonly<{ fact: TrpcFact; binding: TrpcFactBinding<TContext> }>;

function check<TContext extends object>({
  ports,
  declaration,
  procedure,
  entitlement,
  app,
  facts,
}: {
  ports: TrpcRuntimePorts<TContext>;
  declaration: TrpcAccess;
  procedure: string;
  entitlement?: ApiEntitlement;
  app: (ctx: TContext) => unknown;
  facts: readonly BoundFact<TContext>[];
}) {
  return async ({
    ctx,
    input,
    next,
  }: {
    ctx: TContext;
    input: unknown;
    next: (options: {
      ctx: { handlerArguments: ResolvedAccess };
    }) => Promise<MiddlewareResult<object>>;
  }): Promise<MiddlewareResult<object>> => {
    // Nothing is authenticated for a public procedure and no actor is built
    // for it: the handler is told there is no one behind the request rather
    // than handed a guess.
    if (declaration.kind === "public") {
      const anonymous: ResolvedAccess = {
        app: app(ctx),
        actor: null,
        scope: null,
        facts: await resolveFacts({ facts, ctx }),
      };

      return next({ ctx: { handlerArguments: anonymous } });
    }

    const decision = await authorized({ ports, declaration, ctx, input });

    if (!decision.actor) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required" });
    }

    // After access, never before it: a caller who may not do this at all is
    // told that rather than told to buy something.
    if (entitlement && ports.entitlements) {
      await decideEntitlement({
        entitlement,
        scope: decision.scope,
        entitlements: ports.entitlements,
        address: `tRPC ${procedure}`,
      });
    }

    const handlerArguments: ResolvedAccess = {
      app: app(ctx),
      actor: decision.actor,
      scope: decision.scope,
      facts: await resolveFacts({ facts, ctx }),
    };

    return next({ ctx: { handlerArguments } });
  };
}

/**
 * The declared facts, in declaration order, each parsed by the schema that
 * declared it. A value the schema refuses is the mount's fault, and it is
 * raised here rather than reaching a handler that trusted the type.
 */
async function resolveFacts<TContext extends object>({
  facts,
  ctx,
}: {
  facts: readonly BoundFact<TContext>[];
  ctx: TContext;
}): Promise<readonly unknown[]> {
  const resolved: unknown[] = [];

  for (const { fact, binding } of facts) {
    resolved.push(fact.schema.parse(await binding.resolve(ctx)));
  }

  return resolved;
}

/**
 * The one check, with the anonymous refusal spelled the way the transport
 * spells it: an authentication failure is a 401 on the wire, not a fault.
 */
async function authorized<TContext extends object>({
  ports,
  declaration,
  ctx,
  input,
}: {
  ports: TrpcRuntimePorts<TContext>;
  declaration: AccessDeclaration;
  ctx: TContext;
  input: unknown;
}) {
  try {
    return await decide({
      declaration,
      caller: ports.identity.caller(ctx),
      input,
      authorize: ports.authorization.forRequest(ctx),
      denials: ports.denials,
    });
  } catch (failure) {
    if (failure instanceof AuthenticationRequiredError) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: failure.message });
    }

    throw failure;
  }
}

/**
 * Reports an answer its own declared schema refuses without changing the
 * transport answer. A response mismatch is a server defect, not a new 500.
 */
function validateDeclaredOutput({
  procedure,
  schema,
  value,
}: {
  procedure: string;
  schema: z.ZodType;
  value: unknown;
}): unknown {
  const parsed = schema.safeParse(value);

  if (parsed.success) return parsed.data;

  outputLogger.error(
    {
      endpoint: procedure,
      protocol: "trpc",
      validation: validationMeta(parsed.error, { privacy: "schema-only" }),
    },
    "tRPC handler response did not match its declared output schema",
  );

  return value;
}

/**
 * The handler, with its answer checked against the declaration. A stream is
 * checked one value at a time, because a subscription's shape drifts one event
 * at a time and a single wrong yield is what a client crashes on.
 */
function guardOutput({
  procedure,
  kind,
  output,
  handler,
}: {
  procedure: string;
  kind: TrpcContractMember["kind"];
  output: z.ZodType | undefined;
  handler: (args: never, ...facts: never[]) => unknown;
}): (opts: ResolverOptions) => unknown {
  const invoke = (opts: ResolverOptions): unknown => {
    const { args, facts } = invocation(opts);

    return (handler as (args: HandlerArguments, ...values: unknown[]) => unknown)(args, ...facts);
  };

  if (!output) {
    return async (opts: ResolverOptions) => voidOutput({ procedure, value: await invoke(opts) });
  }

  if (kind === "subscription") {
    return (opts: ResolverOptions) => ({
      async *[Symbol.asyncIterator]() {
        const stream = (await invoke(opts)) as AsyncIterable<unknown>;

        for await (const value of stream) {
          yield validateDeclaredOutput({ procedure, schema: output, value });
        }
      },
    });
  }

  return async (opts: ResolverOptions) =>
    validateDeclaredOutput({ procedure, schema: output, value: await invoke(opts) });
}

/** Reports a value from a procedure that declared no output at all. */
function voidOutput({ procedure, value }: { procedure: string; value: unknown }): unknown {
  if (value === undefined) return value;

  outputLogger.error(
    {
      endpoint: procedure,
      protocol: "trpc",
      validation: { expected: "void", received: typeof value },
    },
    "tRPC handler response did not match its declared output schema",
  );

  return value;
}

/** The handler's own arguments, and the facts that follow them. */
function invocation(request: ResolverOptions): {
  args: HandlerArguments;
  facts: readonly unknown[];
} {
  const resolved = resolvedAccessOf(request.ctx);

  if (!resolved) throw new Error("tRPC procedure reached its handler with no access decision");

  const { facts, ...access } = resolved;

  return { args: { ...access, input: request.input, signal: request.signal }, facts };
}

/** Reads back what the access step wrote, and nothing it did not write. */
function resolvedAccessOf(ctx: object): ResolvedAccess | undefined {
  if (!("handlerArguments" in ctx)) return undefined;

  const resolved = ctx.handlerArguments;

  return isResolvedAccess(resolved) ? resolved : undefined;
}

function isResolvedAccess(value: unknown): value is ResolvedAccess {
  const named = typeof value === "object" && value !== null;

  return named && "app" in value && "actor" in value && "scope" in value && "facts" in value;
}

/** Puts a failed call on its span the way the log line already puts it in Loki. */
function recordSpanError({
  span,
  error,
  asError,
}: {
  span: Span;
  error: unknown;
  asError: (failure: unknown) => Error;
}): void {
  const failure = asError(error);
  span.recordException(failure);

  // A middleware may hand us the TRPCError wrapper or the domain error itself,
  // depending on where in the chain the failure was caught.
  const candidate = error instanceof TRPCError ? error.cause : error;
  const handled = HandledError.isHandled(candidate) ? candidate : undefined;

  if (handled) {
    span.setAttributes({
      "langwatch.error.code": handled.code,
      "langwatch.error.fault": handled.fault,
    });

    // A 404 for a row someone deleted is the system working; marking it ERROR
    // counts routine refusals against every SLO built on span status.
    if (handled.fault === "customer") return;
  }

  span.setStatus({ code: SpanStatusCode.ERROR, message: failure.message });
}

function tracer<TContext extends TrpcRuntimeContext & object>(ports: TrpcRuntimePorts<TContext>) {
  const asError = (failure: unknown): Error => ports.errors.asError(failure);

  return async ({
    ctx,
    path,
    type,
    next,
  }: {
    ctx: TContext;
    path: string;
    type: ProcedureType;
    next: () => Promise<MiddlewareResult<object>>;
  }): Promise<MiddlewareResult<object>> => {
    const otel = otelTrace.getTracer("langwatch:trpc");
    const spanName = `trpc.${path}`;
    const parentContext = callerTraceContext({ req: ctx.req, type });

    // For silenced routes we want zero spans on the happy path — they
    // otherwise drown out the trace surface — but failures still need a span.
    if (isSilencedCall({ path, type })) {
      const startTime = nowInstant().epochMilliseconds;
      const result = await next();

      if (result.ok) return result;

      const span = otel.startSpan(
        spanName,
        { kind: SpanKind.SERVER, startTime, attributes: spanAttributes({ path, type }) },
        parentContext,
      );

      trpcFailureTraceIds.remember(result.error, span);
      recordSpanError({ span, error: result.error, asError });
      span.end();

      return result;
    }

    return otelContext.with(parentContext, () =>
      otel.startActiveSpan(
        spanName,
        { kind: SpanKind.SERVER, attributes: spanAttributes({ path, type }) },
        async (span) => {
          // In tRPC v11 next() never throws. Downstream errors are returned as
          // { ok: false, error } result objects — NOT thrown.
          const result = await next();

          if (!result.ok) {
            trpcFailureTraceIds.remember(result.error, span);
            recordSpanError({ span, error: result.error, asError });
          }

          span.end();

          return result;
        },
      ),
    );
  };
}

function spanAttributes({ path, type }: { path: string; type: string }) {
  return { "rpc.system": "trpc", "rpc.method": path, "rpc.type": type } as const;
}

function requestLog<TContext extends TrpcRuntimeContext & object>(
  ports: TrpcRuntimePorts<TContext>,
  { anonymous }: { anonymous: boolean },
) {
  return async ({
    ctx,
    path,
    type,
    input,
    next,
  }: {
    ctx: TContext;
    path: string;
    type: ProcedureType;
    input: unknown;
    next: () => Promise<MiddlewareResult<object>>;
  }): Promise<MiddlewareResult<object>> => {
    const scopeIds = auditScopeIds(input);

    // A procedure that runs with no caller asks the process nothing about who
    // is calling — not even to leave the field blank in the log line.
    const requestContext: RequestContext = {
      organizationId: scopeIds.organizationId,
      projectId: scopeIds.projectId,
      userId: anonymous ? undefined : ports.identity.caller(ctx).actor?.id,
    };

    return runWithContext(requestContext, async () => {
      const start = nowInstant().epochMilliseconds;
      const result = await next();
      const duration = nowInstant().epochMilliseconds - start;

      recordTrpcCall({
        result,
        path,
        type,
        duration,
        userAgent: ctx.req?.headers["user-agent"] ?? null,
        statusCode: ctx.res?.statusCode ?? null,
        log: logger,
        capture: (failure: unknown) => ports.errors.report(failure),
      });

      return result;
    });
  };
}

/**
 * Converts handled errors thrown in handlers to properly coded TRPCErrors.
 * Without this they fall through as INTERNAL_SERVER_ERROR. A bare Zod failure
 * from inside a service is promoted the same way the REST door promotes it, so
 * one throw is not a 422 through Hono and a 500 through tRPC.
 */
function handledErrors<TContext extends object>(ports: TrpcRuntimePorts<TContext>) {
  return async ({
    next,
  }: {
    next: () => Promise<MiddlewareResult<object>>;
  }): Promise<MiddlewareResult<object>> => {
    const result = await next();

    if (result.ok) return result;

    const cause = result.error.cause;

    if (HandledError.isHandled(cause)) {
      throw new TRPCError({ code: trpcCodeOf(cause), message: cause.message, cause });
    }

    if (isZodLikeError(cause)) {
      const validation = ValidationError.fromZodError(cause);

      // The code, not the message: zod's message is the whole issue array as
      // JSON, and the wire message is the code either way (#5984).
      throw new TRPCError({
        code: trpcCodeOf(validation),
        message: validation.code,
        cause: validation,
      });
    }

    const translated = ports.errors.translate(cause);

    if (translated) {
      throw new TRPCError({ code: translated.code, message: translated.message, cause });
    }

    return result;
  };
}

/**
 * Every 4xx a handled error raises needs a line here. The fallback is
 * INTERNAL_SERVER_ERROR, so a missing entry books a customer-side refusal as a
 * server fault. 5xx are deliberately left to the fallback: they are ours
 * either way, and the client keys its copy off `code`.
 */
const TRPC_CODE_BY_STATUS: Partial<Record<number, TRPCError["code"]>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  // tRPC has no PAYMENT_REQUIRED; FORBIDDEN is what the enterprise guard
  // already answers for the same refusal.
  402: "FORBIDDEN",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  // tRPC has no GONE. NOT_FOUND is the closest reading of an expired link.
  410: "NOT_FOUND",
  412: "PRECONDITION_FAILED",
  413: "PAYLOAD_TOO_LARGE",
  422: "UNPROCESSABLE_CONTENT",
  // tRPC has no 425 Too Early; PRECONDITION_FAILED is what the dataset routers
  // already used for a still-preparing dataset.
  425: "PRECONDITION_FAILED",
  429: "TOO_MANY_REQUESTS",
};

function trpcCodeOf(error: HandledError): TRPCError["code"] {
  return TRPC_CODE_BY_STATUS[error.httpStatus] ?? "INTERNAL_SERVER_ERROR";
}

/** Writes the audit row for a mutation, with the arguments the owner redacted. */
function auditTrail<TContext extends TrpcRuntimeContext & object>(
  ports: TrpcRuntimePorts<TContext>,
  { anonymous }: { anonymous: boolean },
) {
  return async ({
    ctx,
    next,
    type,
    path,
    input,
    getRawInput,
  }: {
    ctx: TContext;
    next: () => Promise<MiddlewareResult<object>>;
    type: ProcedureType;
    path: string;
    input: unknown;
    getRawInput: GetRawInputFn;
  }): Promise<MiddlewareResult<object>> => {
    // There is nobody to attribute a public procedure's write to, so the trail
    // is not asked who it was.
    if (anonymous) return next();

    const actor = ports.identity.caller(ctx).actor;

    if (type !== "mutation" || !actor || ports.audit.exempt(path)) return next();

    const result = await next();
    const audited = input ?? (await getRawInput());
    const target = result.ok ? deriveAuditTarget(path, result.data) : {};
    const scopeIds = auditScopeIds(audited);
    const impersonatorId = impersonatorOf(actor);

    await ports.audit.record({
      userId: actor.id,
      organizationId: scopeIds.organizationId,
      projectId: scopeIds.projectId,
      action: path,
      args: ports.audit.redact({ procedure: path, args: audited }),
      error: result.ok ? undefined : result.error,
      req: ctx.req,
      targetKind: target.targetKind,
      targetId: target.targetId,
      // `userId` above is the impersonated target, which is who the
      // authorization decision was about; the metadata names the human.
      metadata: impersonatorId ? { impersonatorId } : undefined,
    });

    return result;
  };
}

function impersonatorOf(actor: Actor & { id: string }): string | undefined {
  return actor.type === "user" ? actor.impersonatorId : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// The wire shape a failed tRPC call arrives in.
//
// The framework half is here: a handled error is serialised under `data.error`,
// its code replaces the message so no unreviewed prose reaches a customer, the
// stack is stripped, and the trace id captured while the span was live is
// attached. The application half arrives through a port, because those payloads
// are browser contracts rather than API framework policy.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CAUSE_DEPTH = 3;

/**
 * The application payload a client interceptor reads off `data.cause`, for the
 * causes this package does not own. Answers null when the cause is not one of
 * them — which is what the legacy formatter already put on the wire.
 */
export interface TrpcErrorCausePayloadPort {
  payloadFor(cause: unknown): unknown;
}

function donatedMessage(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const message = (cause as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

function isInheritedFromCause(message: string, cause: unknown): boolean {
  let current = cause;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (current === null || current === undefined) return false;

    const donated = donatedMessage(current);
    if (donated !== undefined && message.includes(donated)) return true;
    if (typeof current !== "object") return true;

    current = (current as { cause?: unknown }).cause;
  }
  return current !== null && current !== undefined;
}

export function createTrpcErrorFormatter(
  ports: Readonly<{
    causePayload: TrpcErrorCausePayloadPort;
    traceIds: TrpcFailureTraceIds;
  }>,
) {
  return function errorFormatter({
    shape,
    error,
  }: {
    shape: TRPCDefaultErrorShape;
    error: { cause?: unknown; message?: string; code?: string };
  }) {
    const handled = HandledError.isHandled(error.cause)
      ? error.cause
      : isZodLikeError(error.cause)
        ? ValidationError.fromZodError(error.cause)
        : null;
    const isInternalServerError =
      error.code === "INTERNAL_SERVER_ERROR" || shape?.data?.code === "INTERNAL_SERVER_ERROR";
    const message = handled
      ? handled.code
      : isInternalServerError
        ? HandledError.toUserMessage(error.cause)
        : shape.message;
    const isAuthoredMessage =
      !handled &&
      !isInternalServerError &&
      typeof shape.message === "string" &&
      shape.message.length > 0 &&
      shape.message !== error.code &&
      !isInheritedFromCause(shape.message, error.cause);
    const shapeData = { ...shape.data };
    delete shapeData.stack;

    return {
      ...shape,
      message,
      data: {
        ...shapeData,
        cause: ports.causePayload.payloadFor(error.cause),
        error: handled?.serialize() ?? null,
        authored: isAuthoredMessage,
        traceId: ports.traceIds.find(error),
      },
    };
  };
}
