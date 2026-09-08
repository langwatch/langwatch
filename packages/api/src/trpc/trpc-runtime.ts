/**
 * The one tRPC execution path: authenticate, parse, trace, log, decide, handle,
 * check the answer, audit, respond.
 */

// ORDER IS BEHAVIOUR. Everything that reads the request reads the VALIDATED
// input, so it is installed after the contract's own parser: tRPC appends its
// input middleware where `.input()` is called. A check installed ahead of the
// parser is handed `input === undefined`, reads no scope id, and audits with no
// arguments, no project and no organization. Nothing reports an error.
import type { Actor } from "@langwatch/actor";
import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import { HandledError, isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { createLogger, validationMeta, type RequestContext } from "@langwatch/observability";
import { runWithContext } from "@langwatch/observability/context";
import { nowInstant } from "@langwatch/time";
import {
  context as otelContext,
  trace as otelTrace,
  type Span,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import type {
  AnyTRPCRootTypes,
  TRPCBuiltRouter,
  TRPCDecorateCreateRouterOptions,
  TRPCRootObject,
  TRPCRouterRecord,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { TRPCError } from "@trpc/server";
import type {
  GetRawInputFn,
  MiddlewareResult,
  ProcedureType,
} from "@trpc/server/unstable-core-do-not-import";
import type { z } from "zod";

import {
  AuthenticationRequiredError,
  decide,
  type AccessDeclaration,
  type AccessDenialPort,
  type AuthorizePort,
  type Caller,
} from "../access/access.ts";
import type { TrpcContract, TrpcContractMember } from "../contract/trpc-contract.ts";
import { auditScopeIds, deriveAuditTarget } from "./trpc-audit.ts";
import { isSilencedCall, recordTrpcCall } from "./trpc-call-logging.ts";
import { callerTraceContext } from "./trpc-caller-trace.ts";
import { trpcFailureTraceIds } from "./trpc-failure-trace.ts";
import type {
  TrpcContractProcedures,
  TrpcProcedureFactory,
  TrpcRouterDeclaration,
} from "./trpc-router.ts";

const logger = createLogger("langwatch:trpc");
const outputLogger = createLogger("langwatch:api:output-validation");

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

/** Mounts declared namespaces on one process's root. */
export interface TrpcRuntime<TContext extends object> extends TrpcProcedureFactory<TContext> {
  mount<Api, Contract extends TrpcContract>(
    declaration: TrpcRouterDeclaration<Api, Contract>,
    app: (ctx: TContext) => Api,
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
  ports: TrpcRuntimePorts<TContext>;
}): TrpcRuntime<TContext> {
  const trace = tracer(ports);
  const log = requestLog(ports);
  const handledError = handledErrors(ports);
  const audit = auditTrail(ports);

  const runtime: TrpcRuntime<TContext> = {
    procedure: (request) => {
      // The parser FIRST, then the check: a check installed ahead of `.input()`
      // reads `undefined` and silently authorizes nothing.
      const built = procedure
        .input(request.member.input)
        .use(trace)
        .use(log)
        .use(handledError)
        .use(access({ ports, declaration: request.access, app: request.app }))
        .use(audit);

      const handle = guardOutput({
        procedure: request.procedure,
        kind: request.member.kind,
        output: request.member.output,
        handler: request.handle,
      });

      if (request.member.kind === "query") return built.query(handle);

      if (request.member.kind === "mutation") return built.mutation(handle);

      return built.subscription(handle);
    },
    router: (record) => root.router(record as TRPCRouterRecord),
    mount: (declaration, app) => declaration.router(runtime, app),
  };

  return runtime;
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
  actor: Actor & { id: string };
  scope: unknown;
  signal: AbortSignal | undefined;
}>;

/** What the access step establishes, and the handler is then handed. */
type AccessFacts = Omit<HandlerArguments, "input" | "signal">;

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
  app,
}: {
  ports: TrpcRuntimePorts<TContext>;
  declaration: AccessDeclaration;
  app: (ctx: TContext) => unknown;
}) {
  return declareAuthzMiddleware(declaration, check({ ports, declaration, app }));
}

function check<TContext extends object>({
  ports,
  declaration,
  app,
}: {
  ports: TrpcRuntimePorts<TContext>;
  declaration: AccessDeclaration;
  app: (ctx: TContext) => unknown;
}) {
  return async ({
    ctx,
    input,
    next,
  }: {
    ctx: TContext;
    input: unknown;
    next: (options: {
      ctx: { handlerArguments: AccessFacts };
    }) => Promise<MiddlewareResult<object>>;
  }): Promise<MiddlewareResult<object>> => {
    const decision = await authorized({ ports, declaration, ctx, input });

    if (!decision.actor) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required" });
    }

    const handlerArguments: AccessFacts = {
      app: app(ctx),
      actor: decision.actor,
      scope: decision.scope,
    };

    return next({ ctx: { handlerArguments } });
  };
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
  handler: (args: never) => unknown;
}): (opts: ResolverOptions) => unknown {
  const invoke = (opts: ResolverOptions): unknown =>
    (handler as (args: HandlerArguments) => unknown)(handlerArguments(opts));

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

function handlerArguments(request: ResolverOptions): HandlerArguments {
  const facts = accessFactsOf(request.ctx);

  if (!facts) throw new Error("tRPC procedure reached its handler with no access decision");

  return { ...facts, input: request.input, signal: request.signal };
}

/** Reads back what the access step wrote, and nothing it did not write. */
function accessFactsOf(ctx: object): AccessFacts | undefined {
  if (!("handlerArguments" in ctx)) return undefined;

  const facts = ctx.handlerArguments;

  return isAccessFacts(facts) ? facts : undefined;
}

function isAccessFacts(value: unknown): value is AccessFacts {
  const named = typeof value === "object" && value !== null;

  return named && "app" in value && "actor" in value && "scope" in value;
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

    const requestContext: RequestContext = {
      organizationId: scopeIds.organizationId,
      projectId: scopeIds.projectId,
      userId: ports.identity.caller(ctx).actor?.id,
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
