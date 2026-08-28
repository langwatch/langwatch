import { HandledError } from "@langwatch/handled-error";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { getLogLevelFromStatusCode } from "@langwatch/observability/request";
import {
  isSpanContextValid,
  context as otelContext,
  trace as otelTrace,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { auditLog } from "~/runtime/app/features/audit-log";
import { AiCallFailedError } from "~/server/modelProviders/aiCallFailedError";
import { ModelProviderDisabledError } from "~/server/modelProviders/modelProviderDisabledError";
import { createWarnThrottle } from "~/server/observability/warnThrottle";
import { captureException, toError } from "../../utils/posthogErrorCapture";
import { trpcFailureTraceIds } from "./trpc.failure-trace";
import { appTrpcRoot } from "./trpc.root";

const logger = createLogger("langwatch:trpc");

function auditScopeIds(input: unknown): {
  organizationId: string | undefined;
  projectId: string | undefined;
} {
  if (typeof input !== "object" || input === null) {
    return { organizationId: undefined, projectId: undefined };
  }

  const record = input as Record<string, unknown>;
  return {
    organizationId: typeof record.organizationId === "string" ? record.organizationId : undefined,
    projectId: typeof record.projectId === "string" ? record.projectId : undefined,
  };
}

/** Reusable middleware that enforces users are logged in before running the procedure. */
export const enforceUserIsAuthed = appTrpcRoot.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

export const enforcePermissionCheck = appTrpcRoot.middleware(({ ctx, next }) => {
  if (!ctx.permissionChecked) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Permission check is required",
    });
  }
  return next();
});

const auditLogTRPCErrors = appTrpcRoot.middleware(
  async ({ ctx, next, path, type, input, getRawInput }) => {
    const result = await next();
    if (
      (type !== "mutation" || !ctx.permissionChecked) && // avoid duplicated audit logs for mutations
      !result.ok &&
      result.error instanceof TRPCError &&
      result.error.code !== "INTERNAL_SERVER_ERROR" &&
      ctx.session?.user.id
    ) {
      const auditedInput = input ?? (await getRawInput());
      const scopeIds = auditScopeIds(auditedInput);
      await auditLog({
        userId: ctx.session.user.id,
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
        // When an admin is impersonating, `session.user.id` reflects the
        // impersonated user (correct for RBAC attribution). We stamp the
        // real admin's identity in metadata so security forensics can
        // filter on `metadata.impersonatorId` to find actions that were
        // actually performed by an admin.
        metadata: ctx.session.user.impersonator
          ? { impersonatorId: ctx.session.user.impersonator.id }
          : undefined,
      });
    }

    return result;
  },
);

/**
 * Pull the resource ID + kind from a tRPC mutation result so the audit
 * row's `targetId` / `targetKind` columns are populated. Without this,
 * the audit log shows an empty Target column for Platform-side rows
 * (Ariana caught this on the γ post-dogfood UI bug-bash — admin
 * auditing "what did I just create?" couldn't see the new resource id
 * on their own click's audit row, only on the gateway-side mirror row).
 *
 * Best-effort: tries common shapes (id at root, .source.id, .{tail}.id
 * where tail is the resource name from the path), and derives kind
 * from the path's leading segment via a small map. Returns nulls
 * when the result shape isn't one we know — leaving the columns blank
 * is fine, that's the legacy behavior.
 */
function deriveAuditTarget(
  path: string,
  data: unknown,
): { targetKind?: string; targetId?: string } {
  if (!data || typeof data !== "object") return {};
  const root = path.split(".")[0] ?? "";
  // Path-prefix → targetKind. Mirrors the gateway adapter's
  // GATEWAY_AUDIT_TARGET_KINDS where applicable; new platform-side
  // resources land here.
  const TARGET_KIND_BY_ROUTER: Record<string, string> = {
    gatewayBudgets: "budget",
    virtualKeys: "virtual_key",
    personalVirtualKeys: "virtual_key",
    gatewayProviders: "provider_binding",
    cacheRules: "cache_rule",
    ingestionSources: "ingestion_source",
    anomalyRules: "anomaly_rule",
    routingPolicy: "routing_policy",
    aiTools: "ai_tool_entry",
    aiToolsCatalog: "ai_tool_entry",
    organization: "organization",
    project: "project",
    team: "team",
    user: "user",
  };
  const targetKind = TARGET_KIND_BY_ROUTER[root];
  // Best-effort id extraction. Mutations return one of:
  //   1. entity directly ({ id })
  //   2. wrapped ({ source: { id } }, { budget: { id } })
  //   3. tuple with one-shot secret ({ source, ingestSecret })
  //   4. array of entities ([{ id }, ...]) — bulk creates
  //   5. array of wrapped ([{ invite: { id } }, ...]) — createInvites shape
  //   6. wrapped array ({ invites: [{ id }] }) — alt bulk shape
  // First non-empty id wins; ok to log only the first when many exist
  // (the args column already shows the input — Target is a navigation
  // anchor, not a complete inventory).
  const firstId = findFirstId(data);
  return firstId ? { targetKind, targetId: firstId } : { targetKind };
}

function findFirstId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findFirstId(item);
      if (id) return id;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === "string") return obj.id;
  // One level of named-field walk into objects + arrays. We don't
  // recurse arbitrarily deep — the audit Target column is best-effort,
  // and an unbounded walk would surface unrelated ids buried in nested
  // payloads.
  for (const key of Object.keys(obj)) {
    const child = obj[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object") {
          const itemId = (item as Record<string, unknown>).id;
          if (typeof itemId === "string") return itemId;
          // One more level for {invites:[{invite:{id}}]} shape
          for (const innerKey of Object.keys(item)) {
            const inner = (item as Record<string, unknown>)[innerKey];
            if (inner && typeof inner === "object" && !Array.isArray(inner)) {
              const innerId = (inner as Record<string, unknown>).id;
              if (typeof innerId === "string") return innerId;
            }
          }
        }
      }
    } else if (child && typeof child === "object") {
      const childId = (child as Record<string, unknown>).id;
      if (typeof childId === "string") return childId;
    }
  }
  return undefined;
}

/**
 * Mutations that fire on a heartbeat / per-tab cadence and aren't worth
 * recording in the audit log. `presence.*` runs every ~15s per open tab
 * (heartbeat + cursor broadcasts + leave on pagehide); auditing them
 * buries every genuine action — project edits, deletions, role changes —
 * under a wall of `presence.update` rows. They're already silenced from
 * the request log via SILENCED_LOG_PATH_PREFIXES; this is the audit-log
 * equivalent.
 *
 * Add new entries here when a router's mutations exist purely for
 * ephemeral session state that doesn't need a permanent forensic record.
 */
const AUDIT_LOG_EXEMPT_PATHS = new Set(["user.updateLastLogin"]);
const AUDIT_LOG_EXEMPT_PATH_PREFIXES = ["presence."] as const;

function isAuditLogExempt(path: string): boolean {
  if (AUDIT_LOG_EXEMPT_PATHS.has(path)) return true;
  return AUDIT_LOG_EXEMPT_PATH_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Fields on a model-provider write whose values are secrets. All three ride
 * the same `modelProvider.update` mutation: `customKeys` holds the API key as
 * typed, `providerConfig` is a passthrough object we do not get to police, and
 * `extraHeaders` is precisely where an `Authorization: Bearer …` is entered.
 */
const CREDENTIAL_OBJECT_FIELDS = ["customKeys", "providerConfig"] as const;

/**
 * Action paths whose input carries values a person typed for one run, keyed by
 * the field that holds them.
 *
 * `parameters` on a run can hold a credential: a scenario can declare a
 * parameter secret, and the value is supplied when the run starts.
 * `templateVariables` on the http test button is where the same person types a
 * test token. Both field names are ordinary words other mutations use for
 * harmless things, so the rule is bound to the action rather than to the name.
 *
 * The names are kept: "which parameters did this run set" is the part of the
 * record worth having.
 */
const REDACTED_VALUE_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "suites.run": ["parameters"],
  "scenarios.run": ["parameters"],
  "httpProxy.execute": ["templateVariables"],
};

/**
 * Action paths whose input holds a credential directly in a field, rather than
 * inside an object. `redactObjectField` deliberately ignores a plain string, so
 * these would otherwise be stored as typed. `value` is an ordinary word other
 * mutations use for harmless things, so the rule is bound to the action.
 */
const REDACTED_SCALAR_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "secrets.create": ["value"],
  "secrets.update": ["value"],
};

/** Keeps an object's field names, drops every value. */
function redactValues(source: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.keys(source).map((name) => [name, "[redacted]"]));
}

/** The object fields whose values this action must not store. */
function redactedObjectFieldsFor(action?: string): readonly string[] {
  if (!action) return CREDENTIAL_OBJECT_FIELDS;
  return [...CREDENTIAL_OBJECT_FIELDS, ...(REDACTED_VALUE_FIELDS_BY_ACTION[action] ?? [])];
}

/**
 * The redacted form of one field, or undefined when the field holds nothing to
 * redact.
 *
 * No schema produces an array here, but a redactor has to fail safe on a shape
 * it did not expect rather than wave it through: the cost of guessing wrong is
 * a secret in a durable table.
 */
function redactObjectField(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Array.isArray(value)
    ? value.map(() => "[redacted]")
    : redactValues(value as Record<string, unknown>);
}

/**
 * The redacted form of an `extraHeaders` list.
 *
 * A list of `{ key, value }` pairs rather than an object, so the header name
 * survives and only what it carries is dropped. An entry of any other shape is
 * replaced whole: a redactor cannot tell a name from a value in a shape it does
 * not know, and a header is where an `Authorization: Bearer …` is typed.
 */
function redactHeaderValues(headers: readonly unknown[]): unknown[] {
  return headers.map((header) => {
    if (typeof header !== "object" || header === null) return "[redacted]";
    const { key } = header as Record<string, unknown>;
    return typeof key === "string" ? { key, value: "[redacted]" } : "[redacted]";
  });
}

/**
 * Strips credential values out of what the audit trail persists.
 *
 * `auditLog` stores `args` verbatim — on every model-provider write, and now
 * on the credential probe too, since that had to become a mutation to keep the
 * key out of a URL. A secret in a durable, queryable table is worse than one
 * in a request line, so the values go. The field names stay, because "which
 * credentials were set" is the part of the record worth having.
 *
 * `action` is the tRPC path. It selects the rules that only apply to one
 * mutation, such as a run's parameter values.
 */
export function redactAuditArgs({ input, action }: { input: unknown; action?: string }): unknown {
  if (typeof input !== "object" || input === null) return input;

  const record = input as Record<string, unknown>;
  let redacted: Record<string, unknown> | undefined;

  // Built lazily so input carrying no credentials is returned as-is rather
  // than copied — the audit row is then the object the procedure received.
  const replace = (field: string, value: unknown) => {
    redacted ??= { ...record };
    redacted[field] = value;
  };

  for (const field of redactedObjectFieldsFor(action)) {
    const value = redactObjectField(record[field]);
    if (value !== undefined) replace(field, value);
  }

  for (const field of (action ? REDACTED_SCALAR_FIELDS_BY_ACTION[action] : undefined) ?? []) {
    if (record[field] !== undefined) replace(field, "[redacted]");
  }

  if (Array.isArray(record.extraHeaders)) {
    replace("extraHeaders", redactHeaderValues(record.extraHeaders));
  }

  return redacted ?? input;
}

export const auditLogMutations = appTrpcRoot.middleware(
  async ({ ctx, next, type, path, input, getRawInput }) => {
    if (type !== "mutation" || !ctx.session?.user || isAuditLogExempt(path)) {
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

    await auditLog({
      userId: ctx.session.user.id,
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
      metadata: ctx.session.user.impersonator
        ? { impersonatorId: ctx.session.user.impersonator.id }
        : undefined,
    });

    return result;
  },
);

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
function recordSpanError(span: Span, error: unknown): void {
  const e = toError(error);
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

/**
 * Trace id per failed call, captured while its span is still live.
 *
 * `errorFormatter` runs after the middleware chain has unwound and every span
 * has ended, so `getActiveSpan()` there is not the span that saw the failure.
 * A handled error carries its own `traceId` (captured at construction), but an
 * unhandled one has nothing — and it is exactly the unhandled case where the
 * id is the only thing support gets. Keyed weakly so a retained error can't
 * pin the entry.
 */
/**
 * The trace context the caller sent with this call, so a tRPC span continues
 * the trace the browser started rather than rooting a fresh one. Without this
 * the UI and the server work it triggers are two unrelated traces, which is the
 * common case because most of the product talks tRPC rather than REST.
 *
 * A local span already on the context wins. When tRPC is served through the
 * HTTP router, its `tracerMiddleware` has already extracted the same
 * `traceparent` and opened the `POST /api` server span that is executing this
 * call — re-extracting would parent the procedure to the *remote* browser span
 * instead, leaving the HTTP span a childless sibling and losing the fact that
 * one contains the other. Extraction is therefore only for callers that arrive
 * with no local span at all.
 *
 * Only the request-per-call transports are consulted. The WebSocket and SSE
 * links hold one long-lived connection, so `ctx.req` there is the *handshake*
 * request — extracting from it would parent every later call on that socket to
 * whatever trace happened to open it. Browsers cannot set headers on a
 * WebSocket handshake, so there is normally nothing to extract, but the rule is
 * stated rather than relied upon.
 *
 * See ADR-058.
 */
export function callerTraceContext({
  req,
  type,
}: {
  // Only the headers are read, and callers range from the Node request to the
  // WS handshake to nothing at all (SSG helpers), so this asks for the one
  // thing it uses rather than for a request type it would have to lie about.
  req: { headers?: Record<string, string | string[] | undefined> } | undefined;
  type: string;
}) {
  const active = otelContext.active();
  if (type === "subscription") return active;

  const localSpan = otelTrace.getSpan(active)?.spanContext();
  if (localSpan && isSpanContextValid(localSpan)) return active;

  const headers = req?.headers;
  if (!headers) return active;

  return propagation.extract(active, headers);
}

export const tracerMiddleware = appTrpcRoot.middleware(async ({ ctx, path, type, next }) => {
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
    recordSpanError(span, result.error);
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
          recordSpanError(span, result.error);
        }
        span.end();
        return result;
      },
    ),
  );
});

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
 * Converts HandledErrors thrown in procedures to properly-coded TRPCErrors.
 * Without this, HandledErrors fall through as INTERNAL_SERVER_ERROR.
 * Placed inner to loggerMiddleware so the logger sees the correct code.
 */
export const handledErrorMiddleware = appTrpcRoot.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && HandledError.isHandled(result.error.cause)) {
    const domainError = result.error.cause;
    throw new TRPCError({
      code: handledErrorToTRPCCode(domainError),
      message: domainError.message,
      cause: domainError,
    });
  }
  if (!result.ok && result.error.cause instanceof ModelNotConfiguredError) {
    // Re-raise as a typed BAD_REQUEST TRPCError so the errorFormatter
    // serialises the cause into `data.cause` for the frontend
    // interceptor. Without this middleware the error falls through as
    // INTERNAL_SERVER_ERROR and the missing-model modal never opens.
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.error.cause.message,
      cause: result.error.cause,
    });
  }
  if (!result.ok && result.error.cause instanceof AiCallFailedError) {
    // Same shape as ModelNotConfiguredError: re-raise as BAD_REQUEST so
    // the wire code matches the user-actionable nature of the toast
    // ("double-check your model configuration") instead of falling
    // through as a generic 500 that monitoring + retry policies treat
    // as a server fault.
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.error.cause.message,
      cause: result.error.cause,
    });
  }
  if (!result.ok && result.error.cause instanceof ModelProviderDisabledError) {
    // Same shape as the other typed model errors: BAD_REQUEST so the
    // errorFormatter serialises `cause` and the frontend interceptor
    // opens the swap-to-parent toast. Without this re-raise the error
    // bubbles up as a generic INTERNAL_SERVER_ERROR and the user only
    // sees a red "something went wrong" toast.
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.error.cause.message,
      cause: result.error.cause,
    });
  }
  return result;
});

/**
 * How long a call may take before its record is raised from info to warning.
 *
 * A call that succeeds slowly used to log exactly like one that succeeded
 * instantly, so the only way to find one was for a customer to say a screen
 * felt broken. That is how the scenario editor's multi-second load went
 * unnoticed: every procedure on the path reported success, and the duration
 * was already on the record but never changed the level.
 *
 * One second, because that regression ran at 1.5 to 2.3 seconds per call
 * and a higher budget would have kept it invisible. Procedures that are
 * legitimately long (a model generating a draft, an export) still warn,
 * and the warning for those is still true: it states what the call cost.
 * The per-path throttle is what keeps the volume down.
 */
const DEFAULT_SLOW_CALL_MS = 1000;

const SLOW_CALL_THROTTLE_MS = 60_000;

const slowCallThrottle = createWarnThrottle(SLOW_CALL_THROTTLE_MS);

/** Zero or negative turns the warning off; unset or unparseable keeps the default. */
export function resolveSlowCallBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRPC_SLOW_CALL_MS;
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_SLOW_CALL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SLOW_CALL_MS;
}

/** Test seam: the throttle is process-wide state and must not leak between tests. */
export function resetSlowCallThrottle(): void {
  slowCallThrottle.reset();
}

/** Processes a tRPC call result and logs accordingly. Extracted for testability. */
export function handleTrpcCallLogging({
  result,
  path,
  type,
  duration,
  userAgent,
  statusCode,
  log,
  capture,
  slowCallBudgetMs = resolveSlowCallBudgetMs(),
  now = Date.now(),
}: {
  result: { ok: boolean; error?: unknown };
  path: string;
  type: string;
  duration: number;
  userAgent: string | null;
  statusCode: number | null;
  log: Pick<ReturnType<typeof createLogger>, "info" | "warn" | "error">;
  capture: (error: Error | string) => void;
  slowCallBudgetMs?: number;
  now?: number;
}): void {
  const logData: {
    path: string;
    type: string;
    duration: number;
    userAgent: string | null;
    statusCode: number | null;
    error?: unknown;
    handledErrorCode?: string;
    handledErrorFault?: HandledError["fault"];
  } = {
    path,
    type,
    duration,
    userAgent,
    statusCode,
  };

  if (!result.ok) {
    logData.error = result.error;

    // Derive HTTP status from the TRPCError code, not ctx.res.statusCode.
    // The response status hasn't been set yet at middleware time — tRPC sets
    // it later when serializing the response. So we map it ourselves.
    const resolvedStatus =
      result.error instanceof TRPCError ? getHTTPStatusCodeFromError(result.error) : 500;

    const cause = result.error instanceof TRPCError ? result.error.cause : undefined;
    // isHandled also matches an instance from a second copy of the package,
    // which bare `instanceof` misses — see its brand check.
    const handledCause = HandledError.isHandled(cause) ? cause : undefined;

    // A handled error states its own status, and it is the accurate one: tRPC
    // v10 has no code for 502/503/504, so an upstream failure resolves to 500
    // through `handledErrorToTRPCCode` and would otherwise be counted against
    // our own error budget every time a customer typos a base URL.
    logData.statusCode = handledCause?.httpStatus ?? resolvedStatus;

    // Include handled error code + fault in log data for structured
    // filtering (and spike alerting on handledErrorCode).
    if (handledCause) {
      logData.handledErrorCode = handledCause.code;
      logData.handledErrorFault = handledCause.fault;
    }

    // Only unhandled 5xx errors are captured as exceptions: handled errors
    // are expected failure modes with typed causes, not bugs.
    if (resolvedStatus >= 500 && !handledCause) {
      capture(toError(result.error));
    }

    // Handled errors log by fault attribution, not status: customer-fault
    // errors are expected (warn — watched for spikes), while platform and
    // provider failures are incidents worth an error line. Unhandled errors
    // stay status-based.
    const logLevel = handledCause
      ? handledCause.fault === "customer"
        ? "warn"
        : "error"
      : getLogLevelFromStatusCode(resolvedStatus);
    log[logLevel](logData, "trpc call");
    return;
  }

  // The call succeeded, so this is not a failure and the record carries no
  // cause. It is raised only because the time it took is worth watching by
  // rate, which is what warning means here.
  if (slowCallBudgetMs > 0 && duration > slowCallBudgetMs) {
    const suppressed = slowCallThrottle.claim({ key: path, now });
    if (suppressed !== undefined) {
      log.warn(
        {
          ...logData,
          budgetMs: slowCallBudgetMs,
          suppressedSincePrevious: suppressed,
        },
        "trpc call",
      );
      return;
    }
  }

  log.info(logData, "trpc call");
}

/**
 * Routers whose calls flood the request log without being useful for
 * debugging: presence (peer cursor / drawer presence heartbeats fire
 * every few seconds per open tab). Logging + tracing them buries the
 * signal in noise. Errors are still reported by the middlewares below.
 */
const SILENCED_LOG_PATH_PREFIXES = ["presence."] as const;

/**
 * tRPC call types whose volume is unbounded — SSE subscriptions emit
 * a "trpc call" log line per delivered message. Silencing the
 * subscription type as a whole keeps the dev log readable without
 * sprinkling per-router opt-outs across the codebase.
 */
const SILENCED_LOG_TYPES = new Set(["subscription"]);

function isSilencedPath(path: string): boolean {
  return SILENCED_LOG_PATH_PREFIXES.some((p) => path.startsWith(p));
}

function isSilencedCall({ path, type }: { path: string; type: string }): boolean {
  return isSilencedPath(path) || SILENCED_LOG_TYPES.has(type);
}

/**
 * Records one finished tRPC call: decides whether it is logged at all, then
 * how loudly.
 *
 * The two halves belong together. Silencing runs first and drops the record
 * entirely, so "a slow presence heartbeat raises nothing" is a property of the
 * pair and of neither alone. Asserting it against the classifier proves only
 * that a boolean is what it is, and asserting it against the logger tests a
 * call the middleware never makes. This is the seam that can be asked the real
 * question.
 */
export function recordTrpcCall(args: Parameters<typeof handleTrpcCallLogging>[0]): void {
  // Errors are still reported on a silenced path: the volume that earns the
  // silence is happy-path volume, and a failing heartbeat is worth seeing.
  if (isSilencedCall({ path: args.path, type: args.type }) && args.result.ok) {
    return;
  }
  handleTrpcCallLogging(args);
}

export const loggerMiddleware = appTrpcRoot.middleware(async ({ path, type, input, ctx, next }) => {
  // Import context utilities dynamically to avoid circular deps
  const { createContextFromTRPC, runWithContext } = await import("../context/asyncContext");

  // Create context from tRPC context and input
  const requestContext = createContextFromTRPC(ctx, auditScopeIds(input));

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
      capture: captureException,
    });

    return result;
  });
});

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const authProtectedProcedure = appTrpcRoot.procedure
  .use(enforceUserIsAuthed)
  .use(auditLogTRPCErrors);
