/**
 * The fluent chain a feature's tRPC surface is defined through — the tRPC twin
 * of `createRestService`.
 *
 *     createTrpcService({ root, procedures })
 *       .query("getProjectAPIKey", (p) =>
 *         p
 *           .withInput(projectScopeSchema)
 *           .withOutput(projectSchema)
 *           .withPermission("project:update")
 *           .handle(async ({ ctx, input }) => …),
 *       )
 *       .build();
 *
 * It builds exactly what a mount used to write by hand —
 * `policy(declaration)(procedure.input(schema)).query(handler)` inside
 * `root.router({})` — with three differences:
 *
 *  - the ordering rule cannot be got wrong. The parser is applied before the
 *    policy by construction, so the authorization check always reads its scope
 *    id from validated input.
 *  - the access declaration is a TYPE requirement: a procedure that never
 *    calls `withPermission` has no callable `handle`. The process's fail-closed
 *    `enforceCheck` backstop stays, as the second line rather than the first.
 *  - the response shape is stated. `withOutput` never reaches tRPC's
 *    `.output()` — that would change the client's inferred output type — so it
 *    is a dev/test guard and the machine-readable statement of what a
 *    procedure answers.
 *
 * Design: dev/docs/plans/trpc-fluent-chain-2026-09-05.md.
 * Spec: packages/api/specs/trpc-framework.feature.
 */
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
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import type { z } from "zod";

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
  policy(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
}>;

/** What `createTrpcService` is given. */
export type TrpcServiceConfig<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  procedures: TrpcServiceProcedures<TContext, TOptions, TRoot>;
  /**
   * Check every answer against its declared output schema and throw on a
   * mismatch. The process decides — this package reads no environment — and
   * production leaves it off: the schema documents the answer, it does not
   * gate it.
   */
  validateOutput?: boolean;
}>;

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
type ClientInput<TInput extends ChainInput> = TInput extends z.ZodType ? z.input<TInput> : void;

type ProcedureDef<TInput extends ChainInput, TResult> = {
  input: ClientInput<TInput>;
  output: Awaited<TResult>;
  meta: object;
};

/** What `handle` returns, which is the real tRPC procedure the router mounts. */
type BuiltProcedure<
  TKind extends "query" | "mutation",
  TInput extends ChainInput,
  TResult,
> = TKind extends "query"
  ? TRPCQueryProcedure<ProcedureDef<TInput, TResult>>
  : TRPCMutationProcedure<ProcedureDef<TInput, TResult>>;

/**
 * `handle` exists only on a chain that has declared its input, its output and
 * its access. Anything else resolves its `this` to `never`, which is TS2684 at
 * the call site — the declaration is mandatory by construction rather than by
 * review.
 */
type ReadyChain<
  TContext extends object,
  TKind extends "query" | "mutation",
  TInput extends ChainInput,
  TOutput extends ChainOutput,
  TDeclared extends boolean,
> = TDeclared extends true
  ? TInput extends TrpcUndeclared
    ? never
    : TOutput extends TrpcUndeclared
      ? never
      : TrpcProcedureChain<TContext, TKind, TInput, TOutput, TDeclared>
  : never;

/** The definition chain of one procedure. */
export interface TrpcProcedureChain<
  TContext extends object,
  TKind extends "query" | "mutation",
  TInput extends ChainInput = TrpcUndeclared,
  TOutput extends ChainOutput = TrpcUndeclared,
  TDeclared extends boolean = false,
> {
  /** The request parser. Applied to the procedure BEFORE the policy chain. */
  withInput<TSchema extends z.ZodType>(
    schema: TSchema,
  ): TrpcProcedureChain<TContext, TKind, TSchema, TOutput, TDeclared>;
  /** No request data at all, with the reason it needs none. */
  withoutInput(
    reason: string,
  ): TrpcProcedureChain<TContext, TKind, TrpcDeclaredAbsent, TOutput, TDeclared>;
  /**
   * The answer's shape. Validated when the process asks for it; never handed
   * to tRPC's `.output()`, so the client's inferred type is the handler's own.
   */
  withOutput<TSchema extends z.ZodType>(
    schema: TSchema,
  ): TrpcProcedureChain<TContext, TKind, TInput, TSchema, TDeclared>;
  /** The answer is not this feature's to describe, with the reason. */
  withoutOutput(
    reason: string,
  ): TrpcProcedureChain<TContext, TKind, TInput, TrpcDeclaredAbsent, TDeclared>;
  /**
   * The access decision, in AuthZ vocabulary: one permission, or a whole
   * declaration (`permission-any`, `no-permission`, `service-authorized`).
   * No role enum reaches a transport file.
   */
  withPermission(
    access: AuthzPermission | AuthzDeclaration,
  ): TrpcProcedureChain<TContext, TKind, TInput, TOutput, true>;
  /**
   * The process's ALREADY-BUILT policy, for a gate it resolves itself from
   * validated input. `reason` is what makes it as reviewable as a declaration.
   */
  withCustomPermission(
    policy: TrpcPolicyDecorator,
    reason: string,
  ): TrpcProcedureChain<TContext, TKind, TInput, TOutput, true>;
  /** The handler. Its `input` is the parsed value of the declared schema. */
  handle<TResult>(
    this: ReadyChain<TContext, TKind, TInput, TOutput, TDeclared>,
    handler: (
      opts: Readonly<{ ctx: TContext; input: HandlerInput<TInput> }>,
    ) => TResult | Promise<TResult>,
  ): BuiltProcedure<TKind, TInput, TResult>;
}

/**
 * The record one more procedure makes, flattened.
 *
 * `TProcedures & { [K in TName]: … }` would read the same and type differently:
 * an intersection is not the object type tRPC's own `router({ … })` produces,
 * so the client's router type would stop being IDENTICAL to the hand-written
 * one and start being merely assignable to it.
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
> {
  query<TName extends string, TInput extends ChainInput, TResult>(
    name: TName,
    define: (
      chain: TrpcProcedureChain<TContext, "query">,
    ) => BuiltProcedure<"query", TInput, TResult>,
  ): TrpcService<
    TContext,
    TOptions,
    TRoot,
    WithProcedure<TProcedures, TName, BuiltProcedure<"query", TInput, TResult>>
  >;
  mutation<TName extends string, TInput extends ChainInput, TResult>(
    name: TName,
    define: (
      chain: TrpcProcedureChain<TContext, "mutation">,
    ) => BuiltProcedure<"mutation", TInput, TResult>,
  ): TrpcService<
    TContext,
    TOptions,
    TRoot,
    WithProcedure<TProcedures, TName, BuiltProcedure<"mutation", TInput, TResult>>
  >;
  /** The router the process mounts, built by the root's own factory. */
  build(): TRPCBuiltRouter<TRoot, TRPCDecorateCreateRouterOptions<TProcedures>>;
}

/**
 * The `.input()` / `.query()` / `.mutation()` surface of a tRPC procedure
 * builder, named structurally at the one seam that applies a feature's parser
 * and resolver to a builder whose generics belong to the process. The same
 * reason `declaredPolicy` names `ChainableProcedure`.
 */
type BuildableProcedure = Readonly<{
  input(schema: z.ZodType): BuildableProcedure;
  query(resolver: (opts: never) => unknown): unknown;
  mutation(resolver: (opts: never) => unknown): unknown;
}>;

type ChainState = {
  input?: z.ZodType;
  output?: z.ZodType;
  policy?: TrpcPolicyDecorator;
};

/**
 * Refuses an answer its own declared schema refuses. Loud on purpose: a shape
 * that drifted from its declaration is a defect in the procedure, and the
 * whole point of finding it in test or development is that it is cheap there.
 */
function guardOutput(
  name: string,
  schema: z.ZodType,
  handler: (opts: never) => unknown,
): (opts: never) => Promise<unknown> {
  return async (opts: never) => {
    const result = await handler(opts);
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        `tRPC procedure "${name}" answered with a value its declared output schema refuses: ` +
          parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
            .join("; "),
      );
    }
    // The handler's own value, unparsed: validating must not strip or coerce
    // what the client already receives.
    return result;
  };
}

function buildProcedure({
  name,
  kind,
  state,
  procedure,
  validateOutput,
  handler,
}: {
  name: string;
  kind: "query" | "mutation";
  state: ChainState;
  procedure: BuildableProcedure;
  validateOutput: boolean;
  handler: (opts: never) => unknown;
}): unknown {
  if (!state.policy) {
    throw new Error(`tRPC procedure "${name}" was built without an access declaration`);
  }
  // The parser FIRST, then the policy: a check installed ahead of `.input()`
  // reads `undefined` and silently authorizes nothing.
  const parsed = state.input ? procedure.input(state.input) : procedure;
  const guarded =
    validateOutput && state.output ? guardOutput(name, state.output, handler) : handler;
  const decorated = state.policy(parsed);
  return kind === "query" ? decorated.query(guarded) : decorated.mutation(guarded);
}

function createChain<
  TContext extends object,
  TKind extends "query" | "mutation",
  TInput extends ChainInput,
  TOutput extends ChainOutput,
  TDeclared extends boolean,
>(context: {
  name: string;
  kind: TKind;
  state: ChainState;
  procedure: BuildableProcedure;
  policy: (access: AuthzPermission | AuthzDeclaration) => TrpcPolicyDecorator;
  validateOutput: boolean;
}): TrpcProcedureChain<TContext, TKind, TInput, TOutput, TDeclared> {
  const next = <
    TNextInput extends ChainInput,
    TNextOutput extends ChainOutput,
    TNext extends boolean,
  >(
    state: ChainState,
  ): TrpcProcedureChain<TContext, TKind, TNextInput, TNextOutput, TNext> =>
    createChain<TContext, TKind, TNextInput, TNextOutput, TNext>({ ...context, state });

  return {
    withInput: (schema) => next({ ...context.state, input: schema }),
    withoutInput: () => next({ ...context.state }),
    withOutput: (schema) => next({ ...context.state, output: schema }),
    withoutOutput: () => next({ ...context.state }),
    withPermission: (access) => next({ ...context.state, policy: context.policy(access) }),
    withCustomPermission: (policy) => next({ ...context.state, policy }),
    handle: (handler) =>
      buildProcedure({
        name: context.name,
        kind: context.kind,
        state: context.state,
        procedure: context.procedure,
        validateOutput: context.validateOutput,
        handler: handler as (opts: never) => unknown,
      }) as BuiltProcedure<TKind, ChainInput, unknown>,
  } as TrpcProcedureChain<TContext, TKind, TInput, TOutput, TDeclared>;
}

/**
 * Opens a feature's tRPC surface. Every procedure it registers is built from
 * the process's own procedure and policy, so tracing, logging, handled-error
 * translation, scope lineage, the authorization check, the fail-closed
 * backstop and the audit trail are exactly the ones the process composed.
 */
export function createTrpcService<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  config: TrpcServiceConfig<TContext, TOptions, TRoot>,
): TrpcService<TContext, TOptions, TRoot, TrpcNoProcedures> {
  const procedure = config.procedures.protected as unknown as BuildableProcedure;
  const validateOutput = config.validateOutput ?? false;

  const service = <TProcedures extends TRPCCreateRouterOptions>(
    record: TRPCRouterRecord,
  ): TrpcService<TContext, TOptions, TRoot, TProcedures> => ({
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
          }),
        ),
      }),
    build: () =>
      config.root.router(record) as TRPCBuiltRouter<
        TRoot,
        TRPCDecorateCreateRouterOptions<TProcedures>
      >,
  });

  return service<TrpcNoProcedures>({});
}
