/**
 * What a finished tRPC call leaves behind: the audit row, what that row is
 * allowed to keep of the arguments, the request-log record, and the two trace
 * handles the record and the error formatter quote.
 */
import { HandledError } from "@langwatch/handled-error";
import { createWarnThrottle, type Logger } from "@langwatch/observability";
import { getLogLevelFromStatusCode } from "@langwatch/observability/request";
import { nowInstant } from "@langwatch/time";
import {
  isSpanContextValid,
  context as otelContext,
  trace as otelTrace,
  propagation,
  type Span,
} from "@opentelemetry/api";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

// ─────────────────────────────────────────────────────────────────────────────
// The audit row: which scopes a call named, which resource it produced, and
// whether it is worth recording at all.
// ─────────────────────────────────────────────────────────────────────────────

export function auditScopeIds(input: unknown): {
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

/**
 * Mutations that fire on a heartbeat / per-tab cadence and aren't worth
 * recording in the audit log. `presence.*` runs every ~15s per open tab
 * (heartbeat + cursor broadcasts + leave on pagehide); auditing them
 * buries every genuine action - project edits, deletions, role changes —
 * under a wall of `presence.update` rows. They're already silenced from
 * the request log via SILENCED_LOG_PATH_PREFIXES; this is the audit-log
 * equivalent.
 */
const AUDIT_LOG_EXEMPT_PATHS = new Set(["user.updateLastLogin"]);
const AUDIT_LOG_EXEMPT_PATH_PREFIXES = ["presence."] as const;

export function isAuditLogExempt(path: string): boolean {
  if (AUDIT_LOG_EXEMPT_PATHS.has(path)) return true;
  return AUDIT_LOG_EXEMPT_PATH_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Pull the resource ID + kind from a tRPC mutation result so the audit
 * row's `targetId` / `targetKind` columns are populated. Without this,
 * the audit log shows an empty Target column for Platform-side rows.
 *
 * Best-effort: tries common shapes (id at root, .source.id, .{tail}.id
 * where tail is the resource name from the path), and derives kind
 * from the path's leading segment via a small map.
 */
export function deriveAuditTarget(
  path: string,
  data: unknown,
): { targetKind?: string; targetId?: string } {
  if (!data || typeof data !== "object") return {};
  const segments = path.split(".");
  const root = segments[0] ?? "";
  // Path-prefix → targetKind. Mirrors the gateway adapter's
  // GATEWAY_AUDIT_TARGET_KINDS where applicable; new platform-side
  // resources land here. A namespace assembled from two features names its
  // sub-router as well, because one kind cannot be honest for both halves.
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
    "analytics.savedWorkbenchCharts": "saved_workbench_chart",
    apiKey: "api_key",
    github: "github_connection",
    license: "license",
    llmModelCost: "llm_model_cost",
    modelProvider: "model_provider",
    scimToken: "scim_token",
    subscription: "subscription",
    webhookEndpoints: "webhook_endpoint",
  };
  // A namespace whose mutations produce no resource of their own - a
  // translation, an analytics run, a report that a limit blocked - names no
  // kind: an audit row would claim a target that was never written.
  const targetKind =
    TARGET_KIND_BY_ROUTER[segments.slice(0, 2).join(".")] ?? TARGET_KIND_BY_ROUTER[root];
  // Best-effort id extraction. Mutations return one of:
  //   1. entity directly ({ id })
  //   2. wrapped ({ source: { id } }, { budget: { id } })
  //   3. tuple with one-shot secret ({ source, ingestSecret })
  //   4. array of entities ([{ id }, ...]) - bulk creates
  //   5. array of wrapped ([{ invite: { id } }, ...]) - createInvites shape
  //   6. wrapped array ({ invites: [{ id }] }) - alt bulk shape
  const firstId = findFirstId(data);
  return firstId ? { targetKind, targetId: firstId } : { targetKind };
}

/**
 * One entry of a named field's array: its own `id`, or the `id` of a single
 * object one level inside it - the `{ invites: [{ invite: { id } }] }` shape.
 */
function findIdInArrayEntry(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const itemId = (item as Record<string, unknown>).id;
  if (typeof itemId === "string") return itemId;
  for (const innerKey of Object.keys(item)) {
    const inner = (item as Record<string, unknown>)[innerKey];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const innerId = (inner as Record<string, unknown>).id;
      if (typeof innerId === "string") return innerId;
    }
  }
  return undefined;
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
  // recurse arbitrarily deep - the audit Target column is best-effort,
  // and an unbounded walk would surface unrelated ids buried in nested
  // payloads.
  for (const key of Object.keys(obj)) {
    const child = obj[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const id = findIdInArrayEntry(item);
        if (id) return id;
      }
    } else if (child && typeof child === "object") {
      const childId = (child as Record<string, unknown>).id;
      if (typeof childId === "string") return childId;
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Redaction: what the audit trail is allowed to keep of a call's arguments.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fields on a model-provider write whose values are secrets. All three ride the same `modelProvider.update`
 * mutation: `customKeys` holds the API key as typed, `providerConfig` is a passthrough object we do not get to
 * police, and `extraHeaders` is precisely where an `Authorization: Bearer …` is entered.
 */
const CREDENTIAL_OBJECT_FIELDS = ["customKeys", "providerConfig"] as const;

/**
 * Action paths whose input carries values a person typed for one run, keyed by
 * the field that holds them.
 */
const REDACTED_VALUE_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "suites.run": ["parameters"],
  "scenarios.run": ["parameters"],
  "httpProxy.execute": ["templateVariables"],
};

/**
 * Action paths whose input holds a credential directly in a field, rather than inside an object.
 * `redactObjectField` deliberately ignores a plain string, so these would otherwise be stored as typed. `value` is
 * an ordinary word other mutations use for harmless things, so the rule is bound to the action.
 */
const REDACTED_SCALAR_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "secrets.create": ["value"],
  "secrets.update": ["value"],
  "license.generate": ["privateKey"],
  "license.upload": ["licenseKey"],
};

/**
 * Field names that carry credential material whatever mutation they ride on.
 */
const SENSITIVE_FIELD_NAME =
  /(password|passphrase|privatekey|publickey|secretkey|sharedsecret|clientsecret|signingkey|apikey|accesskey|encryptionkey|licensekey|certificate|secret|token(?!s)|credential|slackwebhook|webhookurl|authorization|bearer)/;

/** Whether a field's name says its value is credential material. */
function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_NAME.test(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * The depth the name rule walks to. A mutation input is a form, not a
 * document; past this the cost of walking is real and the odds of a secret are
 * not.
 */
const MAX_SCAN_DEPTH = 8;

/**
 * The same value with every sensitively-named field replaced, or undefined
 * when the value holds no such field.
 */
function redactSensitiveNames(value: unknown, depth = 0): unknown {
  if (depth >= MAX_SCAN_DEPTH || typeof value !== "object" || value === null) return undefined;

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const redacted = redactSensitiveNames(entry, depth + 1);
      if (redacted === undefined) return entry;
      changed = true;
      return redacted;
    });
    return changed ? next : undefined;
  }

  const record = value as Record<string, unknown>;
  let next: Record<string, unknown> | undefined;
  for (const [name, field] of Object.entries(record)) {
    if (isSensitiveFieldName(name)) {
      next ??= { ...record };
      next[name] = redactObjectField(field) ?? "[redacted]";
      continue;
    }
    const redacted = redactSensitiveNames(field, depth + 1);
    if (redacted !== undefined) {
      next ??= { ...record };
      next[name] = redacted;
    }
  }
  return next;
}

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
 */
function redactObjectField(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Array.isArray(value)
    ? value.map(() => "[redacted]")
    : redactValues(value as Record<string, unknown>);
}

/**
 * The redacted form of an `extraHeaders` list.
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
 */
export function redactAuditArgs({ input, action }: { input: unknown; action?: string }): unknown {
  if (typeof input !== "object" || input === null) return input;

  const record = input as Record<string, unknown>;
  // The standing name rule runs first and at every depth; the action rules
  // below then cover the fields whose names say nothing.
  let redacted = redactSensitiveNames(record) as Record<string, unknown> | undefined;
  const source = redacted ?? record;

  // Built lazily so input carrying no credentials is returned as-is rather
  // than copied - the audit row is then the object the procedure received.
  const replace = (field: string, value: unknown) => {
    redacted ??= { ...source };
    redacted[field] = value;
  };

  for (const field of redactedObjectFieldsFor(action)) {
    const value = redactObjectField(source[field]);
    if (value !== undefined) replace(field, value);
  }

  for (const field of (action ? REDACTED_SCALAR_FIELDS_BY_ACTION[action] : undefined) ?? []) {
    if (source[field] !== undefined) replace(field, "[redacted]");
  }

  if (Array.isArray(source.extraHeaders)) {
    replace("extraHeaders", redactHeaderValues(source.extraHeaders));
  }

  return redacted ?? input;
}

// ─────────────────────────────────────────────────────────────────────────────
// The request-log record for one finished call.
//
// Everything here is pure: the log target and the exception reporter arrive as
// arguments, so the decisions - whether a call is recorded at all, at which
// level, and with which status - can be asked directly.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long a call may take before its record is raised from info to warning.
 *
 * A call that succeeds slowly used to log exactly like one that succeeded
 * instantly, so the only way to find one was for a customer to say a screen
 * felt broken. One second, because the regression that motivated it ran at 1.5
 * to 2.3 seconds per call and a higher budget would have kept it invisible.
 * The per-path throttle is what keeps the volume down.
 */
const DEFAULT_SLOW_CALL_MS = 1000;

const SLOW_CALL_THROTTLE_MS = 60_000;

const slowCallThrottle = createWarnThrottle(SLOW_CALL_THROTTLE_MS);

/**
 * Zero or negative turns the warning off; unset or unparseable keeps the
 * default.
 *
 * `env` is required rather than defaulted to `process.env`: a reusable package
 * receives typed configuration and does not read the environment itself, which
 * is what `environment-boundaries` enforces.
 */
export function resolveSlowCallBudgetMs(env: NodeJS.ProcessEnv): number {
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
  // The package's own constant, never an environment read. A composition root
  // that wants the operator override resolves it with
  // `resolveSlowCallBudgetMs(process.env)` and passes the number in.
  slowCallBudgetMs = DEFAULT_SLOW_CALL_MS,
  now = nowInstant().epochMilliseconds,
}: {
  result: { ok: boolean; error?: unknown };
  path: string;
  type: string;
  duration: number;
  userAgent: string | null;
  statusCode: number | null;
  log: Pick<Logger, "info" | "warn" | "error">;
  /**
   * Reports an unhandled server fault. Takes the failure as it arrived: the
   * process owns how an unknown value becomes an Error, and coercing it here
   * would put a second copy of that rule in this package.
   */
  capture: (failure: unknown) => void;
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
    // The response status hasn't been set yet at middleware time - tRPC sets
    // it later when serializing the response. So we map it ourselves.
    const resolvedStatus =
      result.error instanceof TRPCError ? getHTTPStatusCodeFromError(result.error) : 500;

    const cause = result.error instanceof TRPCError ? result.error.cause : undefined;
    // isHandled also matches an instance from a second copy of the package,
    // which bare `instanceof` misses - see its brand check.
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
      capture(result.error);
    }

    // Handled errors log by fault attribution, not status: customer-fault
    // errors are expected (warn - watched for spikes), while platform and
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
 * tRPC call types whose volume is unbounded - SSE subscriptions emit
 * a "trpc call" log line per delivered message. Silencing the
 * subscription type as a whole keeps the dev log readable without
 * sprinkling per-router opt-outs across the codebase.
 */
const SILENCED_LOG_TYPES = new Set(["subscription"]);

function isSilencedPath(path: string): boolean {
  return SILENCED_LOG_PATH_PREFIXES.some((p) => path.startsWith(p));
}

export function isSilencedCall({ path, type }: { path: string; type: string }): boolean {
  return isSilencedPath(path) || SILENCED_LOG_TYPES.has(type);
}

/**
 * Records one finished tRPC call: decides whether it is logged at all, then
 * how loudly.
 *
 * The two halves belong together. Silencing runs first and drops the record
 * entirely, so "a slow presence heartbeat raises nothing" is a property of the
 * pair and of neither alone.
 */
export function recordTrpcCall(args: Parameters<typeof handleTrpcCallLogging>[0]): void {
  // Errors are still reported on a silenced path: the volume that earns the
  // silence is happy-path volume, and a failing heartbeat is worth seeing.
  if (isSilencedCall({ path: args.path, type: args.type }) && args.result.ok) {
    return;
  }
  handleTrpcCallLogging(args);
}

// ─────────────────────────────────────────────────────────────────────────────
// The two trace handles: the caller's context a span continues, and the trace
// id a failure is quoted with after the middleware chain unwinds.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The trace context the caller sent with this call, so a tRPC span continues
 * the trace the browser started rather than rooting a fresh one.
 *
 * A local span already on the context wins: when tRPC is served through the
 * HTTP router its tracer middleware has already extracted the same
 * `traceparent` and opened the server span executing this call, and
 * re-extracting would parent the procedure to the remote browser span instead.
 * Only the request-per-call transports are consulted - the WebSocket and SSE
 * links hold one long-lived connection, so their `req` is the handshake.
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

/**
 * Keeps the trace captured while a tRPC span is live until formatting happens
 * after the middleware chain unwinds. Weak keys prevent failed calls from
 * retaining request errors.
 */
export class TrpcFailureTraceIds {
  private readonly traceIds = new WeakMap<object, string>();

  remember(error: unknown, span: Span): void {
    if (error && typeof error === "object") {
      this.traceIds.set(error, span.spanContext().traceId);
    }
  }

  find(error: unknown): string | undefined {
    const remembered = error && typeof error === "object" ? this.traceIds.get(error) : undefined;
    return remembered ?? otelTrace.getActiveSpan()?.spanContext().traceId;
  }
}

export const trpcFailureTraceIds = new TrpcFailureTraceIds();
