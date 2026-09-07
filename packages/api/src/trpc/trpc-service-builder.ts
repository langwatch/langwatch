/**
 * The fluent chain a feature's tRPC surface is defined through, the tRPC twin
 * of `createRestService`. Design: packages/api/adrs/006-trpc-fluent-chain.md.
 * Spec: packages/api/specs/trpc-framework.feature.
 */

//     createTrpcService({ root, procedures })
//       .query("getProjectAPIKey", (p) =>
//         p.withInput(S).withOutput(S).withPermission("project:update")
//          .handle(async ({ ctx, input }) => …))

// It builds what a mount used to write by hand —
// `policy(declaration)(procedure.input(schema)).query(handler)` inside
// `root.router({})` — with three differences.

// The ordering rule cannot be got wrong: the parser is applied before the
// policy by construction, so the authorization check always reads its scope
// id from validated input.

// The access declaration is a TYPE requirement: a procedure that never calls
// `withPermission` has no callable `handle`. The process's fail-closed
// `enforceCheck` backstop stays, as the second line rather than the first.

// The response shape is stated. `withOutput` never reaches tRPC's `.output()`
// — that would change the client's inferred output type — so it is a dev/test
// guard and the machine-readable statement of what a procedure answers.

import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import type {
  AnyTRPCRootTypes,
  TRPCBuiltRouter,
  TRPCDecorateCreateRouterOptions,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
  TRPCCreateRouterOptions,
  TRPCRootObject,
  TRPCRouterRecord,
  TRPCSubscriptionProcedure,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import type { z } from "zod";
import type { ApiHandlerArguments } from "../handler-arguments.ts";
import type { TrpcHandlerBinding } from "./trpc-handler.ts";
import { parseGovernedOutput, resolveTrustedHandlerArguments } from "./trpc-handler.ts";

/** One procedure, wrapped in the process's policy chain. */
export type TrpcPolicyDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

/**
 * What the chain needs from the process: the authenticated procedure to build
 * on, and the policy for one declaration. Structurally the same two members
 * `createTrpcApiService` returns, so a mount passes its service straight in.
 */
export type TrpcServiceProcedures<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Optional: a surface whose every procedure declares `withCustomPermission`
   * never asks the process to resolve a declaration, and passing an identity
   * function to satisfy the type only hides that. `withPermission` on a
   * surface that supplied none refuses by name.
   */
  policy?(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
}>;

/** What `createTrpcService` is given. */
export type TrpcServiceConfig<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TApp = never,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  procedures: TrpcServiceProcedures<TContext, TOptions, TRoot>;
  /**
   * Check every answer against its declared output schema and throw on a
   * mismatch. The process decides — this package reads no environment — and
   * production leaves it off: the schema documents, it does not gate.
   */
}> &
  ([TApp] extends [never]
    ? Readonly<{ validateOutput?: boolean }>
    : Readonly<{ handlerBinding: TrpcHandlerBinding<TContext, TApp>; validateOutput?: never }>);

/** A declaration this chain has not made yet. */
export type TrpcUndeclared = Readonly<{ readonly __undeclared: true }>;
/** `withoutInput` / `withoutOutput`: declared, deliberately, as nothing. */
export type TrpcDeclaredAbsent = Readonly<{ readonly __absent: true }>;

type ChainInput = z.ZodType | TrpcUndeclared | TrpcDeclaredAbsent;
type ChainOutput = z.ZodType | TrpcUndeclared | TrpcDeclaredAbsent;

/** What the handler is handed: the PARSED input, or nothing. */
type HandlerInput<TInput extends ChainInput> = TInput extends z.ZodType
  ? z.output<TInput>
  : undefined;
/** What the CLIENT sends, which is the parser's input side. */
type ClientInput<TInput extends ChainInput> = TInput extends z.ZodType
  ? z.input<TInput>
  : undefined;

type ProcedureDef<TInput extends ChainInput, TOutput> = {
  input: ClientInput<TInput>;
  output: TOutput;
  meta: object;
};

/** Every kind of procedure the chain builds. */
type ProcedureKind = "query" | "mutation" | "subscription";

/**
 * What a subscription answers, as tRPC types it: the stream itself, not the
 * promise of one. A `tracked()` yield is NOT supported — tRPC unwraps its
 * envelope through a type it does not export — and nothing here uses one.
 */
type SubscriptionOutput<TResult> =
  TResult extends AsyncIterable<infer TYield, infer TReturn, infer TNext>
    ? AsyncIterable<TYield, TReturn, TNext>
    : never;

/**
 * The real tRPC procedure a built chain becomes. `TOutput` is the FINISHED
 * client-visible output — not the handler's return type — so a `.query(name,
 * define)` call can infer it back out of what `define` returned.
 */
type BuiltProcedure<
  TKind extends ProcedureKind,
  TInput extends ChainInput,
  TOutput,
> = TKind extends "query"
  ? TRPCQueryProcedure<ProcedureDef<TInput, TOutput>>
  : TKind extends "mutation"
    ? TRPCMutationProcedure<ProcedureDef<TInput, TOutput>>
    : TRPCSubscriptionProcedure<ProcedureDef<TInput, TOutput>>;

/** The client-visible output one handler return type produces, by kind. */
type OutputOf<TKind extends ProcedureKind, TResult> = TKind extends "subscription"
  ? SubscriptionOutput<Awaited<TResult>>
  : Awaited<TResult>;

type GovernedOutputOf<
  TKind extends ProcedureKind,
  TSchema extends z.ZodType,
> = TKind extends "subscription"
  ? SubscriptionOutput<AsyncIterable<z.output<TSchema>>>
  : z.output<TSchema>;

type GovernedHandlerResult<
  TKind extends ProcedureKind,
  TSchema extends z.ZodType,
> = TKind extends "subscription"
  ? AsyncIterable<z.input<TSchema>> | Promise<AsyncIterable<z.input<TSchema>>>
  : z.input<TSchema> | Promise<z.input<TSchema>>;

/**
 * `handle` exists only on a chain that has declared its input, its output and
 * its access. Anything else resolves its `this` to `never` — TS2684 at the
 * call site, so the declaration is mandatory by construction.
 */
type ReadyChain<
  TContext extends object,
  TKind extends ProcedureKind,
  TInput extends ChainInput,
  TOutput extends ChainOutput,
  TDeclared extends boolean,
  TApp = never,
  TActor = never,
  TScope = never,
> = TDeclared extends true
  ? TInput extends TrpcUndeclared
    ? never
    : TOutput extends TrpcUndeclared
      ? never
      : TrpcProcedureChain<TContext, TKind, TInput, TOutput, TDeclared, TApp, TActor, TScope>
  : never;

/** The definition chain of one procedure. */
export interface TrpcProcedureChain<
  TContext extends object,
  TKind extends ProcedureKind,
  TInput extends ChainInput = TrpcUndeclared,
  TOutput extends ChainOutput = TrpcUndeclared,
  TDeclared extends boolean = false,
  TApp = never,
  TActor = never,
  TScope = never,
> {
  /** The request parser. Applied to the procedure BEFORE the policy chain. */
  withInput<TSchema extends z.ZodType>(
    schema: TSchema,
  ): TrpcProcedureChain<TContext, TKind, TSchema, TOutput, TDeclared, TApp, TActor, TScope>;
  /** No request data at all, with the reason it needs none. */
  withoutInput(
    reason: string,
  ): TrpcProcedureChain<
    TContext,
    TKind,
    TrpcDeclaredAbsent,
    TOutput,
    TDeclared,
    TApp,
    TActor,
    TScope
  >;
  /**
   * The answer's shape. Validated when the process asks for it; never handed
   * to tRPC's `.output()`, so the client's inferred type is the handler's own.
   */
  withOutput<TSchema extends z.ZodType>(
    schema: TSchema,
  ): TrpcProcedureChain<TContext, TKind, TInput, TSchema, TDeclared, TApp, TActor, TScope>;
  /** The answer is not this feature's to describe, with the reason. */
  withoutOutput(
    reason: string,
  ): TrpcProcedureChain<
    TContext,
    TKind,
    TInput,
    TrpcDeclaredAbsent,
    TDeclared,
    TApp,
    TActor,
    TScope
  >;
  /**
   * The access decision, in AuthZ vocabulary: one permission, or a whole
   * declaration (`permission-any`, `no-permission`, `service-authorized`).
   * No role enum reaches a transport file.
   */
  withPermission(
    access: AuthzPermission | AuthzDeclaration,
  ): TrpcProcedureChain<TContext, TKind, TInput, TOutput, true, TApp, TActor, TScope>;
  /**
   * The process's ALREADY-BUILT policy, for a gate it resolves itself from
   * validated input. `reason` is what makes it as reviewable as a declaration.
   */
  withCustomPermission(
    policy: TrpcPolicyDecorator,
    reason: string,
  ): TrpcProcedureChain<TContext, TKind, TInput, TOutput, true, TApp, TActor, TScope>;
  /**
   * The handler. Its `input` is the parsed value of the declared schema, and
   * `signal` is tRPC's own request signal — `AbortSignal | undefined`, exactly
   * as tRPC types it — which is what a stream stops on when the client leaves.
   */
  handle<TResult>(
    this: [TApp] extends [never]
      ? ReadyChain<TContext, TKind, TInput, TOutput, TDeclared, TApp, TActor, TScope>
      : TInput extends z.ZodType
        ? TOutput extends z.ZodType
          ? ReadyChain<TContext, TKind, TInput, TOutput, TDeclared, TApp, TActor, TScope>
          : never
        : never,
    handler: [TApp] extends [never]
      ? (
          opts: Readonly<{
            ctx: TContext;
            input: HandlerInput<TInput>;
            signal: AbortSignal | undefined;
          }>,
        ) => TResult | Promise<TResult>
      : (
          opts: ApiHandlerArguments<HandlerInput<TInput>, TApp>,
        ) => GovernedHandlerResult<TKind, Extract<TOutput, z.ZodType>>,
  ): [TApp] extends [never]
    ? BuiltProcedure<TKind, TInput, OutputOf<TKind, TResult>>
    : BuiltProcedure<TKind, TInput, GovernedOutputOf<TKind, Extract<TOutput, z.ZodType>>>;
}

/**
 * The record one more procedure makes, flattened. An intersection would read
 * the same and type differently — it is not the object type tRPC's own
 * `router({ … })` produces — so the router would stop being IDENTICAL.
 */
type WithProcedure<
  TProcedures extends TRPCCreateRouterOptions,
  TName extends string,
  TProcedure,
> = {
  [K in keyof TProcedures | TName]: K extends TName
    ? TProcedure
    : K extends keyof TProcedures
      ? TProcedures[K]
      : never;
};

/** A service that has registered nothing yet. */
type TrpcNoProcedures = Record<never, never>;

/** The service: one `.query` / `.mutation` per procedure, then `.build()`. */
export interface TrpcService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TProcedures extends TRPCCreateRouterOptions,
  TApp = never,
  TActor = never,
  TScope = never,
> {
  query<TName extends string, TInput extends ChainInput, TOutput>(
    name: TName,
    define: (
      chain: TrpcProcedureChain<
        TContext,
        "query",
        TrpcUndeclared,
        TrpcUndeclared,
        false,
        TApp,
        TActor,
        TScope
      >,
    ) => BuiltProcedure<"query", TInput, TOutput>,
  ): TrpcService<
    TContext,
    TOptions,
    TRoot,
    WithProcedure<TProcedures, TName, BuiltProcedure<"query", TInput, TOutput>>,
    TApp,
    TActor,
    TScope
  >;
  mutation<TName extends string, TInput extends ChainInput, TOutput>(
    name: TName,
    define: (
      chain: TrpcProcedureChain<
        TContext,
        "mutation",
        TrpcUndeclared,
        TrpcUndeclared,
        false,
        TApp,
        TActor,
        TScope
      >,
    ) => BuiltProcedure<"mutation", TInput, TOutput>,
  ): TrpcService<
    TContext,
    TOptions,
    TRoot,
    WithProcedure<TProcedures, TName, BuiltProcedure<"mutation", TInput, TOutput>>,
    TApp,
    TActor,
    TScope
  >;
  /**
   * A stream. Its handler is an async generator, and `withOutput` — when the
   * process asks for validation — checks every value it yields, because a
   * stream's shape drifts one event at a time.
   */
  subscription<TName extends string, TInput extends ChainInput, TOutput>(
    name: TName,
    define: (
      chain: TrpcProcedureChain<
        TContext,
        "subscription",
        TrpcUndeclared,
        TrpcUndeclared,
        false,
        TApp,
        TActor,
        TScope
      >,
    ) => BuiltProcedure<"subscription", TInput, TOutput>,
  ): TrpcService<
    TContext,
    TOptions,
    TRoot,
    WithProcedure<TProcedures, TName, BuiltProcedure<"subscription", TInput, TOutput>>,
    TApp,
    TActor,
    TScope
  >;
  /**
   * A child router under `name`, already built — its own `createTrpcService`,
   * or a router the process composed. The nesting is the record's, so the
   * client's inferred shape is exactly what hand-writing `router({ name })`
   * produced.
   */
  router<TName extends string, TRouter extends TRPCCreateRouterOptions[string]>(
    name: TName,
    child: TRouter,
  ): TrpcService<
    TContext,
    TOptions,
    TRoot,
    WithProcedure<TProcedures, TName, TRouter>,
    TApp,
    TActor,
    TScope
  >;
  /** The router the process mounts, built by the root's own factory. */
  build(): TRPCBuiltRouter<TRoot, TRPCDecorateCreateRouterOptions<TProcedures>>;
}

/**
 * A tRPC procedure builder's parser-and-resolver surface, named structurally
 * at the one seam applying a feature's own to a builder whose generics belong
 * to the process. The same reason `declaredPolicy` names `ChainableProcedure`.
 */
type BuildableProcedure = Readonly<{
  input(schema: z.ZodType): BuildableProcedure;
  query(resolver: (opts: never) => unknown): unknown;
  mutation(resolver: (opts: never) => unknown): unknown;
  subscription(resolver: (opts: never) => unknown): unknown;
}>;

type ChainState = {
  input?: z.ZodType;
  output?: z.ZodType;
  policy?: TrpcPolicyDecorator;
};

/**
 * Refuses an answer its own declared schema refuses. Loud on purpose: a shape
 * that drifted from its declaration is a defect in the procedure, and finding
 * it in test or development is cheap.
 */
function assertDeclaredOutput(name: string, schema: z.ZodType, value: unknown): void {
  const parsed = schema.safeParse(value);
  if (parsed.success) return;
  throw new Error(
    `tRPC procedure "${name}" answered with a value its declared output schema refuses: ` +
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; "),
  );
}

/** The guard around one answer. @see assertDeclaredOutput */
function guardOutput(
  name: string,
  schema: z.ZodType,
  handler: (opts: never) => unknown,
  parse: boolean,
): (opts: never) => Promise<unknown> {
  return async (opts: never) => {
    const result = await handler(opts);
    if (parse) return parseGovernedOutput(schema, result);
    assertDeclaredOutput(name, schema, result);
    return result;
  };
}

/**
 * The same guard for a stream: every value it yields is checked, because a
 * subscription's shape drifts one event at a time and a single wrong yield is
 * what a client crashes on.
 */
function guardStream(
  name: string,
  schema: z.ZodType,
  handler: (opts: never) => unknown,
  parse: boolean,
): (opts: never) => AsyncIterable<unknown> {
  return (opts: never) => ({
    async *[Symbol.asyncIterator]() {
      const stream = (await handler(opts)) as AsyncIterable<unknown>;
      for await (const value of stream) {
        if (parse) {
          yield await parseGovernedOutput(schema, value);
        } else {
          assertDeclaredOutput(name, schema, value);
          yield value;
        }
      }
    },
  });
}

function buildProcedure({
  name,
  kind,
  state,
  procedure,
  validateOutput,
  parseOutput,
  handler,
}: {
  name: string;
  kind: ProcedureKind;
  state: ChainState;
  procedure: BuildableProcedure;
  validateOutput: boolean;
  handler: (opts: never) => unknown;
  parseOutput?: boolean;
}): unknown {
  if (parseOutput && !state.output) {
    throw new Error(`tRPC procedure "${name}" requires an output schema at the governed boundary`);
  }
  if (parseOutput && !state.input) {
    throw new Error(`tRPC procedure "${name}" requires an input schema at the governed boundary`);
  }
  if (!state.policy) {
    throw new Error(`tRPC procedure "${name}" was built without an access declaration`);
  }
  // The parser FIRST, then the policy: a check installed ahead of `.input()`
  // reads `undefined` and silently authorizes nothing.
  const parsed = state.input ? procedure.input(state.input) : procedure;
  const guarded =
    validateOutput && state.output
      ? kind === "subscription"
        ? guardStream(name, state.output, handler, parseOutput ?? false)
        : guardOutput(name, state.output, handler, parseOutput ?? false)
      : handler;
  const decorated = state.policy(parsed);
  if (kind === "query") return decorated.query(guarded);
  if (kind === "mutation") return decorated.mutation(guarded);
  return decorated.subscription(guarded);
}

function createChain<
  TContext extends object,
  TKind extends ProcedureKind,
  TInput extends ChainInput,
  TOutput extends ChainOutput,
  TDeclared extends boolean,
  TApp = never,
  TActor = never,
  TScope = never,
>(context: {
  name: string;
  kind: TKind;
  state: ChainState;
  procedure: BuildableProcedure;
  policy: ((access: AuthzPermission | AuthzDeclaration) => TrpcPolicyDecorator) | undefined;
  validateOutput: boolean;
  handlerBinding?: TrpcHandlerBinding<TContext, TApp>;
}): TrpcProcedureChain<TContext, TKind, TInput, TOutput, TDeclared, TApp, TActor, TScope> {
  const next = <
    TNextInput extends ChainInput,
    TNextOutput extends ChainOutput,
    TNext extends boolean,
  >(
    state: ChainState,
  ): TrpcProcedureChain<TContext, TKind, TNextInput, TNextOutput, TNext, TApp, TActor, TScope> =>
    createChain<TContext, TKind, TNextInput, TNextOutput, TNext, TApp, TActor, TScope>({
      ...context,
      state,
    });

  return {
    withInput: (schema) => next({ ...context.state, input: schema }),
    withoutInput: () => next({ ...context.state }),
    withOutput: (schema) => next({ ...context.state, output: schema }),
    withoutOutput: () => next({ ...context.state }),
    withPermission: (access) => {
      if (!context.policy) {
        throw new Error(
          `tRPC procedure "${context.name}" declares withPermission, but the ` +
            `surface was opened with no policy; pass one to createTrpcService`,
        );
      }
      return next({ ...context.state, policy: context.policy(access) });
    },
    withCustomPermission: (policy) => next({ ...context.state, policy }),
    handle: (handler) =>
      buildProcedure({
        name: context.name,
        kind: context.kind,
        state: context.state,
        procedure: context.procedure,
        validateOutput: context.handlerBinding ? true : context.validateOutput,
        parseOutput: Boolean(context.handlerBinding),
        handler: async (opts: never) => {
          const request = opts as {
            ctx: TContext;
            input: HandlerInput<TInput>;
            signal: AbortSignal | undefined;
          };
          if (context.handlerBinding) {
            const trusted = await resolveTrustedHandlerArguments(context.handlerBinding, request);
            return (handler as (args: ApiHandlerArguments<HandlerInput<TInput>, TApp>) => unknown)({
              input: request.input,
              app: trusted.app,
              actor: trusted.actor,
              scope: trusted.scope,
              signal: request.signal,
            });
          }
          return (
            handler as (args: {
              ctx: TContext;
              input: HandlerInput<TInput>;
              signal: AbortSignal | undefined;
            }) => unknown
          )(request);
        },
      }) as BuiltProcedure<TKind, ChainInput, unknown>,
  } as TrpcProcedureChain<TContext, TKind, TInput, TOutput, TDeclared, TApp, TActor, TScope>;
}

/**
 * Opens a feature's tRPC surface. Every procedure is built from the process's
 * own procedure and policy, so tracing, logging, errors, scope lineage, the
 * check, the backstop and the audit trail are the ones the process composed.
 */
export function createTrpcService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TApp = never,
>(
  config: TrpcServiceConfig<TContext, TOptions, TRoot, TApp>,
): TrpcService<TContext, TOptions, TRoot, TrpcNoProcedures, TApp, never, never> {
  const procedure = config.procedures.protected as unknown as BuildableProcedure;
  const validateOutput = config.validateOutput ?? false;

  const service = <TProcedures extends TRPCCreateRouterOptions>(
    record: TRPCRouterRecord,
  ): TrpcService<TContext, TOptions, TRoot, TProcedures, TApp, never, never> => ({
    query: (name, define) =>
      service({
        ...record,
        [name]: define(
          createChain({
            name,
            kind: "query",
            state: {},
            procedure,
            policy: config.procedures.policy,
            validateOutput,
            handlerBinding: "handlerBinding" in config ? config.handlerBinding : undefined,
          }),
        ),
      }),
    mutation: (name, define) =>
      service({
        ...record,
        [name]: define(
          createChain({
            name,
            kind: "mutation",
            state: {},
            procedure,
            policy: config.procedures.policy,
            validateOutput,
            handlerBinding: "handlerBinding" in config ? config.handlerBinding : undefined,
          }),
        ),
      }),
    subscription: (name, define) =>
      service({
        ...record,
        [name]: define(
          createChain({
            name,
            kind: "subscription",
            state: {},
            procedure,
            policy: config.procedures.policy,
            validateOutput,
            handlerBinding: "handlerBinding" in config ? config.handlerBinding : undefined,
          }),
        ),
      }),
    router: (name, child) => service({ ...record, [name]: child as never }),
    build: () =>
      config.root.router(record) as TRPCBuiltRouter<
        TRoot,
        TRPCDecorateCreateRouterOptions<TProcedures>
      >,
  });

  return service<TrpcNoProcedures>({});
}

/** What {@link createTrpcProcedure} is given: no root, because it builds no router. */
export type TrpcProcedureConfig<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  procedures: TrpcServiceProcedures<TContext, TOptions, TRoot>;
  /** @see TrpcServiceConfig.validateOutput */
  validateOutput?: boolean;
}>;

/** One procedure the process mounts by name, with no router around it. */
export interface TrpcBareProcedure<TContext extends object> {
  query<TInput extends ChainInput, TOutput>(
    name: string,
    define: (
      chain: TrpcProcedureChain<TContext, "query">,
    ) => BuiltProcedure<"query", TInput, TOutput>,
  ): BuiltProcedure<"query", TInput, TOutput>;
  mutation<TInput extends ChainInput, TOutput>(
    name: string,
    define: (
      chain: TrpcProcedureChain<TContext, "mutation">,
    ) => BuiltProcedure<"mutation", TInput, TOutput>,
  ): BuiltProcedure<"mutation", TInput, TOutput>;
  subscription<TInput extends ChainInput, TOutput>(
    name: string,
    define: (
      chain: TrpcProcedureChain<TContext, "subscription">,
    ) => BuiltProcedure<"subscription", TInput, TOutput>,
  ): BuiltProcedure<"subscription", TInput, TOutput>;
}

/**
 * The same chain for a surface that IS one procedure, mounted at the root
 * beside routers rather than inside one. `name` is what an output refusal
 * names; it does not decide where the process mounts it.
 */
export function createTrpcProcedure<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(config: TrpcProcedureConfig<TContext, TOptions, TRoot>): TrpcBareProcedure<TContext> {
  const procedure = config.procedures.protected as unknown as BuildableProcedure;
  const chain = (name: string, kind: ProcedureKind) =>
    createChain({
      name,
      kind,
      state: {},
      procedure,
      policy: config.procedures.policy,
      validateOutput: config.validateOutput ?? false,
    });

  return {
    query: (name, define) => define(chain(name, "query") as never),
    mutation: (name, define) => define(chain(name, "mutation") as never),
    subscription: (name, define) => define(chain(name, "subscription") as never),
  };
}
