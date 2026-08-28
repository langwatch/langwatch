/**
 * The process middlewares every tRPC procedure is wrapped in, built once from
 * a root and the ports the process fills.
 *
 * ORDER IS BEHAVIOUR. The chain a declared procedure runs is tracer, logger,
 * handled-error, scope-lineage guard, declared check, `enforcePermissionCheck`,
 * audit — and each of the last four reads the VALIDATED input, so the chain is
 * applied after a procedure's own `.input()` parser, never before it. tRPC
 * appends its input middleware at the point `.input()` is called and runs
 * middlewares in the order they were added; a check installed ahead of the
 * parser is handed `input === undefined`, the authorization check then reads no
 * scope id, the lineage guard compares nothing, and the audit row lands with no
 * arguments, no project and no organization. Nothing reports an error.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type RequestContext } from "@langwatch/observability";
import { runWithContext } from "@langwatch/observability/context";
import {
  context as otelContext,
  trace as otelTrace,
  type Span,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { TRPCError } from "@trpc/server";
import { auditScopeIds, deriveAuditTarget, isAuditLogExempt } from "./trpc-audit.js";
import { redactAuditArgs } from "./trpc-audit-redaction.js";
import { isSilencedCall, recordTrpcCall } from "./trpc-call-logging.js";
import { callerTraceContext } from "./trpc-caller-trace.js";
import { trpcFailureTraceIds } from "./trpc-failure-trace.js";
import type { TrpcPolicyContext } from "./trpc-policy-context.js";
import type {
  TrpcAuditPort,
  TrpcCauseTranslationPort,
  TrpcErrorReportingPort,
  TrpcIdentityPort,
} from "./trpc-policy-ports.js";
import type { TrpcRoot } from "./trpc-root.js";

const logger = createLogger("langwatch:trpc");

/** Everything the process supplies for the policy below to exist. */
export type TrpcRuntimePolicyPorts<TContext, TAuthenticatedContext extends object> = Readonly<{
  identity: TrpcIdentityPort<TContext, TAuthenticatedContext>;
  audit: TrpcAuditPort;
  errorReporting: TrpcErrorReportingPort;
  causes: TrpcCauseTranslationPort;
}>;

function spanAttributes(path: string, type: string) {
  return {
    "rpc.system": "trpc",
    "rpc.method": path,
    "rpc.type": type,
  } as const;
}

/**
 * Put a failed call on its span the way the log line already puts it in Loki.
 *
 * Two things beyond the exception itself:
 *
 *   - `langwatch.error.code` / `langwatch.error.fault` mirror the
 *     `handledErrorCode` / `handledErrorFault` fields `handleTrpcCallLogging`
 *     writes, so support can filter traces by the same facts they filter logs
 *     by instead of grepping exception messages.
 *   - Span status stays UNSET for a customer-fault handled error. A 404 for a
 *     row someone deleted, or a validation rejection, is the system working;
 *     marking it ERROR counts routine refusals against every trace-level error
 *     rate and SLO built on span status. Platform and provider faults, and
 *     anything unhandled, still set ERROR — those are incidents.
 */
function recordSpanError(span: Span, error: unknown, asError: (failure: unknown) => Error): void {
  const e = asError(error);
  span.recordException(e);

  // A middleware may hand us the TRPCError wrapper or the domain error itself,
  // depending on where in the chain the failure was caught.
  const candidate = error instanceof TRPCError ? error.cause : error;
  const handled = HandledError.isHandled(candidate) ? candidate : undefined;
  if (handled) {
    span.setAttributes({
      "langwatch.error.code": handled.code,
      "langwatch.error.fault": handled.fault,
    });
    if (handled.fault === "customer") return;
  }

  span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
}

function handledErrorToTRPCCode(error: HandledError): TRPCError["code"] {
  const map: Partial<Record<number, TRPCError["code"]>> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    // tRPC v10 has no PAYMENT_REQUIRED. FORBIDDEN is what the tRPC-side
    // enterprise guard (`requireEnterprisePlan`) already answers for the same
    // refusal, so a 402 handled error crossing this boundary reads the same
    // as that guard rather than as a server fault. The domain status survives
    // as `data.error.httpStatus`, and the client keys its copy off `code`.
    402: "FORBIDDEN",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    // tRPC has no GONE. NOT_FOUND is the closest reading of an expired
    // invitation link (`invite_expired`): the thing the URL named no longer
    // opens anything, and the client keys its copy off `code` anyway.
    410: "NOT_FOUND",
    412: "PRECONDITION_FAILED",
    413: "PAYLOAD_TOO_LARGE",
    422: "UNPROCESSABLE_CONTENT",
    // tRPC has no 425 Too Early. PRECONDITION_FAILED is what the dataset
    // routers already used for a still-preparing dataset, so the wire status
    // is unchanged now that `DatasetNotReadyError` carries its own 425.
    // Without the entry it would fall through to INTERNAL_SERVER_ERROR and
    // report a normal user-induced race as a server fault.
    425: "PRECONDITION_FAILED",
    429: "TOO_MANY_REQUESTS",
    // 502/503/504 have no key in tRPC v10's code table (added in v11), so an
    // upstream failure has to fall through to INTERNAL_SERVER_ERROR here. The
    // domain status survives on the wire as `data.error.httpStatus`, and
    // `handleTrpcCallLogging` records the handled status rather than this one,
    // so a provider fault is not counted as our 500.
  };
  // Every 4xx a handled error raises needs a line here. The fallback is
  // INTERNAL_SERVER_ERROR, so a missing entry books a customer-side refusal as
  // a server fault — the exact confusion this whole migration exists to end.
  // 5xx are deliberately left to the fallback: they *are* ours either way, and
  // the client keys its copy off `code`, not off the tRPC code.
  return map[error.httpStatus] ?? "INTERNAL_SERVER_ERROR";
}

/**
 * Builds one process's policy middlewares and its authenticated procedure.
 *
 * Called once per root. Every middleware it returns belongs to that root, so a
 * process composes exactly one of these and hands the pieces to its mounts.
 */
export function createTrpcRuntimePolicy<
  TContext extends TrpcPolicyContext & object,
  TAuthenticatedContext extends object,
>(root: TrpcRoot<TContext>, ports: TrpcRuntimePolicyPorts<TContext, TAuthenticatedContext>) {
  /**
   * Reusable middleware that enforces users are logged in before running the
   * procedure. The narrowed context is the process's own — it decides what a
   * signed-in caller looks like downstream, not this package.
   */
  const enforceUserIsAuthed = root.middleware(({ ctx, next }) =>
    next({ ctx: ports.identity.authenticate(ctx) }),
  );

  const enforcePermissionCheck = root.middleware(({ ctx, next }) => {
    if (!ctx.permissionChecked) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Permission check is required",
      });
    }
    return next();
  });

  const auditLogTRPCErrors = root.middleware(
    async ({ ctx, next, path, type, input, getRawInput }) => {
      const result = await next();
      const actor = ports.identity.actor(ctx);
      if (
        (type !== "mutation" || !ctx.permissionChecked) && // avoid duplicated audit logs for mutations
        !result.ok &&
        result.error instanceof TRPCError &&
        result.error.code !== "INTERNAL_SERVER_ERROR" &&
        actor?.id
      ) {
        const auditedInput = input ?? (await getRawInput());
        const scopeIds = auditScopeIds(auditedInput);
        await ports.audit.record({
          userId: actor.id,
          organizationId: scopeIds.organizationId,
          projectId: scopeIds.projectId,
          action: path,
          // Through the same redaction as the success path. This middleware sits
          // ahead of the input parser, so tRPC hands it no parsed `input`;
          // reading the raw input is what puts the arguments, project and
          // organization on a failed call's row instead of leaving them blank.
          args: redactAuditArgs({ input: auditedInput, action: path }),
          error: result.error,
          req: ctx.req,
          // When an admin is impersonating, the actor id reflects the
          // impersonated user (correct for RBAC attribution). We stamp the
          // real admin's identity in metadata so security forensics can
          // filter on `metadata.impersonatorId` to find actions that were
          // actually performed by an admin.
          metadata: actor.impersonatorId ? { impersonatorId: actor.impersonatorId } : undefined,
        });
      }

      return result;
    },
  );

  const auditLogMutations = root.middleware(
    async ({ ctx, next, type, path, input, getRawInput }) => {
      const actor = ports.identity.actor(ctx);
      if (type !== "mutation" || !actor || isAuditLogExempt(path)) {
        return next();
      }

      const result = await next();

      // Package-owned routers mount this on the procedure the process hands
      // them, so it sits ahead of their own `.input()`, and tRPC threads a
      // parsed `input` forward only from a parser that already ran. Without the
      // fallback every such mutation audits with no arguments, no project and
      // no organization. Platform routers parse first and never reach it.
      const auditedInput = input ?? (await getRawInput());

      const target = result.ok ? deriveAuditTarget(path, result.data) : {};
      const scopeIds = auditScopeIds(auditedInput);

      await ports.audit.record({
        userId: actor.id,
        organizationId: scopeIds.organizationId,
        projectId: scopeIds.projectId,
        action: path,
        args: redactAuditArgs({ input: auditedInput, action: path }),
        error: !result.ok ? result.error : undefined,
        req: ctx.req,
        targetKind: target.targetKind,
        targetId: target.targetId,
        // Stamp the real admin id when the action is happening during
        // impersonation. `userId` above is the impersonated target (the
        // RBAC actor); metadata.impersonatorId is the human performing it.
        metadata: actor.impersonatorId ? { impersonatorId: actor.impersonatorId } : undefined,
      });

      return result;
    },
  );

  /** Wrapped rather than passed by reference so the port keeps its own `this`. */
  const asError = (failure: unknown): Error => ports.errorReporting.asError(failure);

  const tracerMiddleware = root.middleware(async ({ ctx, path, type, next }) => {
    const tracer = otelTrace.getTracer("langwatch:trpc");
    const spanName = `trpc.${path}`;

    // For silenced routes (presence heartbeats, SSE subscription
    // messages) we want zero spans on the happy path — they otherwise
    // drown out the trace surface — but failures still need a span so
    // real errors stay visible. Capture the start time before `next()`
    // so the error span's duration matches the actual call.
    const parentContext = callerTraceContext({ req: ctx.req, type });

    if (isSilencedCall({ path, type })) {
      const startTime = Date.now();
      const result = await next();
      if (result.ok) return result;

      const span = tracer.startSpan(
        spanName,
        {
          kind: SpanKind.SERVER,
          startTime,
          attributes: spanAttributes(path, type),
        },
        parentContext,
      );
      trpcFailureTraceIds.remember(result.error, span);
      recordSpanError(span, result.error, asError);
      span.end();
      return result;
    }

    return otelContext.with(parentContext, () =>
      tracer.startActiveSpan(
        spanName,
        { kind: SpanKind.SERVER, attributes: spanAttributes(path, type) },
        async (span) => {
          // IMPORTANT: In tRPC v10, next() never throws. Downstream errors are
          // returned as { ok: false, error } result objects — NOT thrown.
          const result = await next();
          if (!result.ok) {
            trpcFailureTraceIds.remember(result.error, span);
            recordSpanError(span, result.error, asError);
          }
          span.end();
          return result;
        },
      ),
    );
  });

  /**
   * Converts HandledErrors thrown in procedures to properly-coded TRPCErrors.
   * Without this, HandledErrors fall through as INTERNAL_SERVER_ERROR.
   * Placed inner to loggerMiddleware so the logger sees the correct code.
   *
   * A cause the process re-raises with a code of its own — a missing model
   * configuration, a disabled provider — is answered through the cause
   * translation port, because those classes are the application's and the
   * client interceptors that act on them are too.
   */
  const handledErrorMiddleware = root.middleware(async ({ next }) => {
    const result = await next();
    if (result.ok) return result;

    const cause = result.error.cause;
    if (HandledError.isHandled(cause)) {
      throw new TRPCError({
        code: handledErrorToTRPCCode(cause),
        message: cause.message,
        cause,
      });
    }

    const translated = ports.causes.translate(cause);
    if (translated) {
      throw new TRPCError({
        code: translated.code,
        message: translated.message,
        cause,
      });
    }

    return result;
  });

  const loggerMiddleware = root.middleware(async ({ path, type, input, ctx, next }) => {
    const scopeIds = auditScopeIds(input);
    const requestContext: RequestContext = {
      organizationId: scopeIds.organizationId,
      projectId: scopeIds.projectId,
      userId: ports.identity.actor(ctx)?.id,
    };

    return runWithContext(requestContext, async () => {
      const start = Date.now();
      // IMPORTANT: In tRPC v10, next() never throws. Downstream errors are
      // caught by callRecursive and returned as { ok: false, error } result
      // objects. Use result.ok to detect errors — NOT try/catch.
      const result = await next();
      const duration = Date.now() - start;

      recordTrpcCall({
        result,
        path,
        type,
        duration,
        userAgent: ctx.req?.headers["user-agent"] ?? null,
        statusCode: ctx.res?.statusCode ?? null,
        log: logger,
        capture: (failure: unknown) => ports.errorReporting.capture(failure),
      });

      return result;
    });
  });

  /**
   * Protected (authenticated) procedure
   *
   * If you want a query or mutation to ONLY be accessible to logged in users,
   * use this. It verifies the session is valid and guarantees the process's
   * authenticated context is what the resolver sees.
   *
   * @see https://trpc.io/docs/procedures
   */
  const authProtectedProcedure = root.procedure.use(enforceUserIsAuthed).use(auditLogTRPCErrors);

  return {
    authProtectedProcedure,
    auditLogMutations,
    auditLogTRPCErrors,
    enforcePermissionCheck,
    enforceUserIsAuthed,
    handledErrorMiddleware,
    loggerMiddleware,
    tracerMiddleware,
  };
}
