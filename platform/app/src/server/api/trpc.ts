/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import {
  isSpanContextValid,
  context as otelContext,
  trace as otelTrace,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { initTRPC, TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
// The permission-builder below re-implements the typing of tRPC's own
// `procedureBuilder.input`, which is only expressible in terms of these
// internals (v10 exposed them via the `@trpc-internal/*` path aliases).
import type {
  inferParser,
  Parser,
  ProcedureBuilder,
  Simplify,
  UnsetMarker,
} from "@trpc/server/unstable-core-do-not-import";

// Local type replacing CreateNextContextOptions from @trpc/server/adapters/next
// to avoid pulling in the real `next` types.
interface CreateNextContextOptions {
  req: any;
  res: any;
  app: RequestAppServices;
}

import { auditLog } from "~/runtime/app/features/audit-log";
import type {
  AuthzPermission,
  DeclarationError,
  DeclaredAuthzMiddleware,
  NoPermissionOptions,
  ScopeTierField,
  ValidatePermissionForInput,
  ViaFieldFor,
} from "@langwatch/authz-contract";
import { authzDeclarationOf } from "@langwatch/authz-contract";
import {
  HandledError,
  isZodLikeError,
  ValidationError,
} from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { getLogLevelFromStatusCode } from "@langwatch/observability/request";
import superjson from "superjson";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { getApp } from "~/server/app-layer/app";
import type { Session } from "~/server/auth";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { AiCallFailedError } from "~/server/modelProviders/aiCallFailedError";
import { ModelNotConfiguredError } from "~/server/modelProviders/modelNotConfiguredError";
import { ModelProviderDisabledError } from "~/server/modelProviders/modelProviderDisabledError";
import { createWarnThrottle } from "~/server/observability/warnThrottle";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { captureException, toError } from "../../utils/posthogErrorCapture";
import { scopeLineageGuard } from "../app-layer/authz/scope-lineage-guard";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "../app-layer/authz/trpc-middleware";
import type { OpsScope, PermissionMiddleware } from "./rbac";

const logger = createLogger("langwatch:trpc");

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 */

interface CreateContextOptions {
  req?: NextApiRequest;
  res?: NextApiResponse;
  session: Session | null;
  /**
   * The request application this context decides through. Tests can inject a
   * fake here instead of constructing runtime infrastructure.
   */
  app?: RequestAppServices;
  permissionChecked?: boolean;
  publiclyShared?: boolean;
  organizationRole?: OrganizationUserRole | null;
  opsScope?: OpsScope;
  /**
   * Aborts when the client goes away. Long-lived subscriptions must pass this
   * to whatever they wait on, otherwise a disconnected client leaves the
   * generator suspended forever: tRPC v10 callers do not populate
   * `opts.signal`, and the SSE transport cannot interrupt a pending `await`
   * from the outside.
   */
  signal?: AbortSignal;
}

/**
 * This helper generates the "internals" for a tRPC context. If you need to use it, you can export
 * it from here.
 *
 * Examples of things you may need it for:
 * - testing, so we don't have to mock Next.js' req/res
 * - tRPC's `createSSGHelpers`, where we don't have req/res
 *
 * @see https://create.t3.gg/en/usage/trpc#-serverapitrpcts
 */
export const createInnerTRPCContext = (opts: CreateContextOptions) => {
  const requestApp = opts.app ?? createLegacyRequestApp();

  return {
    session: opts.session,
    req: opts.req,
    res: opts.res,
    prisma,
    app: requestApp,
    permissionChecked: opts.permissionChecked ?? false,
    publiclyShared: opts.publiclyShared ?? false,
    organizationRole: opts.organizationRole ?? undefined,
    opsScope: opts.opsScope,
    signal: opts.signal,
  };
};

/**
 * Compatibility-only context for Next handlers and tests that have not yet
 * crossed the explicit transport boundary. The executable Hono/tRPC path
 * always supplies `opts.app`, so it never resolves the process App here.
 */
function createLegacyRequestApp(): RequestAppServices {
  return getApp();
}

/**
 * This is the actual context you will use in your router. It will be used to process every request
 * that goes through your tRPC endpoint.
 *
 * @see https://trpc.io/docs/context
 */
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res, app } = opts;

  // Get the session via the BetterAuth-backed compat helper.
  const session = await getServerAuthSession({ req, res });

  return createInnerTRPCContext({
    req,
    res,
    session,
    app,
    permissionChecked: false,
    publiclyShared: false,
  });
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */

/**
 * How deep to walk a `cause` chain looking for the message tRPC copied.
 *
 * `new TRPCError({ cause })` takes `cause.message` verbatim, and a wrapper
 * (`new Error("…", { cause: driverErr })`) can re-donate the same string one
 * level further down. Three links covers every wrapping we do; a bound also
 * means a self-referential `cause` can't spin here.
 */
const MAX_CAUSE_DEPTH = 3;

/**
 * The message a link in the cause chain donates, if it has one.
 *
 * Not `instanceof Error`: tRPC's `getMessageFromUnknownError` reads `.message`
 * off any object, so a thrown `{ message: "fetch failed" }` — what a fetch
 * wrapper or a deserialised worker error looks like — donates its string just
 * as a real `Error` does. Requiring `instanceof Error` here made that shape
 * invisible to the gate and published the string as our own copy.
 *
 * Empty strings are not a donation. `"".includes` matches everything, so an
 * error carrying `message: ""` would otherwise mark every message inherited.
 */
function donatedMessage(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const message = (cause as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0
    ? message
    : undefined;
}

/**
 * True when `message` is not our words but the caught error's own.
 *
 * tRPC's constructor defaults `message` to `cause.message`, so an inherited
 * message and an authored one are indistinguishable by the time they reach
 * this formatter — except by comparison with the cause that donated it. A
 * procedure that writes its own sentence and passes `cause` for the log line
 * produces a message that matches nothing in the chain, and is authored.
 *
 * CONTAINMENT, not equality. A procedure that interpolates the caught error
 * into its own sentence ("Saving failed: " + err.message) produces a message
 * equal to nothing in the chain, so an equality test called it authored and
 * republished the embedded driver string — the exact leak this gate exists to
 * close, one concatenation away.
 *
 * Deliberately conservative in every direction: a procedure that writes
 * `message: err.message` reads as inherited and degrades to the generic copy,
 * an unreadable cause is assumed to have donated, and a chain longer than the
 * depth budget is assumed to hide a donor we ran out of room to find. Each of
 * those costs a real sentence when it is wrong, and showing a driver string is
 * still the worse of the two mistakes.
 */
function isInheritedFromCause(message: string, cause: unknown): boolean {
  let current = cause;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    // The chain ended without donating anything — the message is ours.
    if (current === null || current === undefined) return false;

    const donated = donatedMessage(current);
    if (donated !== undefined && message.includes(donated)) return true;

    // A primitive (a thrown string, a number) carries no `cause` to walk and
    // nothing we can compare. Unreadable, so assume it donated.
    if (typeof current !== "object") return true;

    current = (current as { cause?: unknown }).cause;
  }
  // Budget spent with links still unexamined. We cannot prove the message is
  // ours, so we do not claim it is.
  return current !== null && current !== undefined;
}

/**
 * The wire contract for every failed tRPC call: what a client is allowed to
 * learn about an error, and in what shape.
 *
 * Exported because the tests drive it directly (see
 * `__tests__/trpc-error-formatter.unit.test.ts`) — `t.create` below passes this
 * very function, so production and tests exercise one code path.
 */
export function errorFormatter({
  shape,
  error,
}: {
  shape: any;
  error: { cause?: unknown; message?: string; code?: string };
}) {
  const cause = error.cause as
    | { limitType?: string; current?: number; max?: number }
    | undefined;
  const limitInfo = cause?.limitType
    ? {
        limitType: cause.limitType,
        current: cause.current,
        max: cause.max,
      }
    : null;

  // Input validation arrives as a ZodError cause. Promote it to the shared
  // ValidationError so it travels the one handled-error channel like every
  // other failure: `fromZodError` flattens the issues into
  // `meta.fieldErrors` / `meta.formErrors`, which is where the contents of the
  // old sidecar `data.zodError` field now live. Mirrors what the Hono handler
  // already does (packages/api/src/errors.ts::validationErrorFromZod). Matched
  // by shape, since the routers behind this one boundary no longer share a
  // single zod and an `instanceof` sees one major only — see `isZodLikeError`.
  const handled = HandledError.isHandled(error.cause)
    ? error.cause
    : isZodLikeError(error.cause)
      ? ValidationError.fromZodError(error.cause)
      : null;

  const domainError = handled?.serialize() ?? null;

  // Surface ModelNotConfiguredError on the wire so the frontend
  // interceptor in `utils/trpcError.ts::extractMissingModelInfo` can
  // open the missing-model modal. `cause` carries a stable
  // discriminator (`code: "MODEL_NOT_CONFIGURED"`) plus the feature
  // metadata the modal needs to render + deep-link.
  const missingModelCause =
    error.cause instanceof ModelNotConfiguredError
      ? {
          code: error.cause.cause,
          featureKey: error.cause.featureKey,
          featureDisplayName: error.cause.featureDisplayName,
          role: error.cause.role,
          projectId: error.cause.projectId,
        }
      : null;

  // Surface AiCallFailedError on the wire so the frontend interceptor
  // in `utils/trpcError.ts::extractAiCallFailedInfo` can show the
  // "double-check your model configuration" toast. Same cause-channel
  // as MODEL_NOT_CONFIGURED — different discriminator code.
  // `originalErrorMessage` is deliberately NOT on this object. It is the
  // provider's own response text, which routinely echoes credential material
  // (an OpenAI 401 body is literally `Incorrect API key provided: sk-proj-…`),
  // and when the call used a LangWatch-managed provider that key is ours, not
  // the customer's. It stays on the server for the log line.
  const aiCallFailedCause =
    error.cause instanceof AiCallFailedError
      ? {
          code: error.cause.cause,
          featureKey: error.cause.featureKey,
          featureDisplayName: error.cause.featureDisplayName,
          role: error.cause.role,
        }
      : null;

  // Surface ModelProviderDisabledError on the wire so the frontend
  // can render a swap-to-parent toast. Carries the cascade-next
  // alternate so the toast's primary CTA can be a one-click swap
  // rather than a generic "open settings" deep link.
  const providerDisabledCause =
    error.cause instanceof ModelProviderDisabledError
      ? error.cause.toResponseBody()
      : null;

  // Free-text error messages never cross the tRPC boundary. `data.error` (code,
  // meta, tips, docsUrl — see SerializedHandledError, which deliberately has no
  // message field) is the entire client contract for handled errors, and
  // presentation is decided client-side by the code-keyed explainers. A
  // HandledError's message is server copy — it can name env vars or internal
  // services — so the wire carries only its stable code. Unhandled 5xx messages
  // can contain Prisma models, SQL, or hostnames and collapse to a generic
  // string. The original error remains on the TRPCError for loggerMiddleware,
  // exception capture, and OTel span recording.
  //
  // `message` and `code` stay at the top level because they are JSON-RPC
  // envelope fields the tRPC client itself runtime-checks (`isTRPCErrorResponse`
  // requires a string message and a numeric code, and discards `data` entirely
  // when either is missing) — not fields we chose.
  const isInternalServerError =
    error.code === "INTERNAL_SERVER_ERROR" ||
    shape?.data?.code === "INTERNAL_SERVER_ERROR";
  const message = handled
    ? handled.code
    : isInternalServerError
      ? HandledError.toUserMessage(error.cause)
      : shape.message;
  // Whether `message` is prose a procedure deliberately wrote for a person.
  //
  // The client renders this one (`readAuthoredMessage`) because #5984 left
  // plain non-5xx messages alone on purpose: several hundred procedures throw
  // a `TRPCError` carrying real copy, and replacing those with "we've been
  // notified" tells the user to wait for something that will never change.
  //
  // But only the server can tell authored copy from an accident, and it needs
  // `cause`, which never crosses the wire. Two accidents to exclude:
  //
  //   - `new TRPCError({ code: "NOT_FOUND" })` — tRPC defaults `message` to
  //     the code NAME, so the customer would read "NOT_FOUND".
  //   - `new TRPCError({ code: "BAD_REQUEST", cause: err })` — tRPC defaults
  //     `message` to the CAUSE's message, so a driver string ("fetch failed",
  //     "Invalid time value") would be presented as our own copy. That is the
  //     leak #5984 closed at 5xx, reopened one status class down.
  //
  // What is NOT an accident is `new TRPCError({ code, message: <copy>, cause:
  // err })` — passing `cause` for the log line while writing the sentence
  // yourself. That is the majority shape in this codebase, and an earlier
  // version of this gate rejected it wholesale on `cause === undefined`,
  // which told an admin who mistyped a rule field to "try again in a moment".
  // So the test is authored-vs-INHERITED, not caused-vs-uncaused.
  //
  // Deciding this here rather than by sniffing the message client-side is the
  // difference between a fact and a guess.
  const isAuthoredMessage =
    !handled &&
    !isInternalServerError &&
    typeof shape.message === "string" &&
    shape.message.length > 0 &&
    shape.message !== error.code &&
    !isInheritedFromCause(shape.message, error.cause);

  // tRPC includes stacks in development error shapes. Local callers should
  // exercise the same safe wire contract as production callers — including on
  // a plain 4xx, which used to keep its stack because this ran only for 5xx
  // and handled errors.
  const shapeData = { ...shape.data };
  delete shapeData.stack;

  return {
    ...shape,
    message,
    data: {
      ...shapeData,
      cause:
        missingModelCause ??
        providerDisabledCause ??
        aiCallFailedCause ??
        limitInfo,
      error: domainError,
      // See `isAuthoredMessage`. Absent/false means the client must not render
      // `message` — it degrades to the generic unknown state instead.
      authored: isAuthoredMessage,
      // The trace id for EVERY failure, not just handled ones. An unhandled
      // error deliberately tells the client nothing about what went wrong
      // (ADR-045), which leaves support with nothing to correlate on — so the
      // one thing it does carry is the id that ties the customer's "it broke"
      // to the logs. Safe to expose: an opaque id is not a detail about the
      // failure, and a handled error already ships it inside `error`.
      traceId: traceIdForError(error),
    },
  };
}

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter,
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/** Reusable middleware that enforces users are logged in before running the procedure. */
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
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

const enforcePermissionCheck = t.middleware(({ ctx, next }) => {
  if (!ctx.permissionChecked) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Permission check is required",
    });
  }
  return next();
});

const auditLogTRPCErrors = t.middleware(
  async ({ ctx, next, path, type, input }) => {
    const result = await next();
    if (
      (type !== "mutation" || !ctx.permissionChecked) && // avoid duplicated audit logs for mutations
      !result.ok &&
      result.error instanceof TRPCError &&
      result.error.code !== "INTERNAL_SERVER_ERROR" &&
      ctx.session?.user.id
    ) {
      await auditLog({
        userId: ctx.session.user.id,
        organizationId: (input as any)?.organizationId,
        projectId: (input as any)?.projectId,
        action: path,
        // Through the same redaction as the success path. This middleware
        // sits before the input parser, so `input` is unset here today; the
        // call is what keeps a chain that changes from storing in clear what
        // the other middleware takes out.
        args: redactAuditArgs({ input, action: path }),
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

/** Keeps an object's field names, drops every value. */
function redactValues(source: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(source).map((name) => [name, "[redacted]"]),
  );
}

/** The object fields whose values this action must not store. */
function redactedObjectFieldsFor(action?: string): readonly string[] {
  if (!action) return CREDENTIAL_OBJECT_FIELDS;
  return [
    ...CREDENTIAL_OBJECT_FIELDS,
    ...(REDACTED_VALUE_FIELDS_BY_ACTION[action] ?? []),
  ];
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
    return typeof key === "string"
      ? { key, value: "[redacted]" }
      : "[redacted]";
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
export function redactAuditArgs({
  input,
  action,
}: {
  input: unknown;
  action?: string;
}): unknown {
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

  if (Array.isArray(record.extraHeaders)) {
    replace("extraHeaders", redactHeaderValues(record.extraHeaders));
  }

  return redacted ?? input;
}

const auditLogMutations = t.middleware(
  async ({ ctx, next, type, path, input }) => {
    if (type !== "mutation" || !ctx.session?.user || isAuditLogExempt(path)) {
      return next();
    }

    const result = await next();

    const target = result.ok ? deriveAuditTarget(path, result.data) : {};

    await auditLog({
      userId: ctx.session.user.id,
      organizationId: (input as any)?.organizationId,
      projectId: (input as any)?.projectId,
      action: path,
      args: redactAuditArgs({ input, action: path }),
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
const errorTraceIds = new WeakMap<object, string>();

function rememberTraceId(error: unknown, span: Span): void {
  if (error && typeof error === "object") {
    errorTraceIds.set(error, span.spanContext().traceId);
  }
}

/** The trace id for a failed call, or the ambient one if we never saw it. */
function traceIdForError(error: unknown): string | undefined {
  const remembered =
    error && typeof error === "object" ? errorTraceIds.get(error) : undefined;
  return remembered ?? otelTrace.getActiveSpan()?.spanContext().traceId;
}

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

export const tracerMiddleware = t.middleware(
  async ({ ctx, path, type, next }) => {
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
      rememberTraceId(result.error, span);
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
            rememberTraceId(result.error, span);
            recordSpanError(span, result.error);
          }
          span.end();
          return result;
        },
      ),
    );
  },
);

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
const handledErrorMiddleware = t.middleware(async ({ next }) => {
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
export function resolveSlowCallBudgetMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
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
  const logData: Record<string, any> = {
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
      result.error instanceof TRPCError
        ? getHTTPStatusCodeFromError(result.error)
        : 500;

    const cause =
      result.error instanceof TRPCError ? result.error.cause : undefined;
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

function isSilencedCall({
  path,
  type,
}: {
  path: string;
  type: string;
}): boolean {
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
export function recordTrpcCall(
  args: Parameters<typeof handleTrpcCallLogging>[0],
): void {
  // Errors are still reported on a silenced path: the volume that earns the
  // silence is happy-path volume, and a failing heartbeat is worth seeing.
  if (isSilencedCall({ path: args.path, type: args.type }) && args.result.ok) {
    return;
  }
  handleTrpcCallLogging(args);
}

export const loggerMiddleware = t.middleware(
  async ({ path, type, input, ctx, next }) => {
    // Import context utilities dynamically to avoid circular deps
    const { createContextFromTRPC, runWithContext } = await import(
      "../context/asyncContext"
    );

    // Create context from tRPC context and input
    const requestContext = createContextFromTRPC(ctx, input as any);

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
  },
);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
const authProtectedProcedure = t.procedure
  .use(enforceUserIsAuthed)
  .use(auditLogTRPCErrors);

type OverwriteIfDefined<TType, TWith> = UnsetMarker extends TType
  ? TWith
  : Simplify<TType & TWith>;

/**
 * Typescript hackery to make sure all endpoints are forced to set the input, then to explicitly tell
 * a permission check middleware to use, and that this permission check should be compatible with the
 * inputs required
 */
interface PendingPermissionProcedureBuilder<
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TCaller extends boolean,
> {
  // Mirrors tRPC core's procedureBuilder.input typing (v11 generics)
  input: <$Parser extends Parser>(
    schema: $Parser,
  ) => PendingPermissionProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    OverwriteIfDefined<TInputIn, inferParser<$Parser>["in"]>,
    OverwriteIfDefined<TInputOut, inferParser<$Parser>["out"]>,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * The custom-check escape hatch, and it only takes middleware that says
   * what it is: `declareAuthzMiddleware(...)` is the sole way to produce the
   * brand, so a hand-rolled function that flips `ctx.permissionChecked`
   * without declaring its policy is a compile error here rather than a CI
   * sweep finding. Non-authz middleware (plan gates, error handlers) belongs
   * AFTER the declaration, on the plain builder this returns.
   */
  use: (
    middleware: DeclaredAuthzMiddleware<PermissionMiddleware<TInputOut>>,
  ) => ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * ADR-092 delivery-plan decision 25: declare the required permission,
   * typed against the validated input the check reads its scope id from.
   * The permission's registry tiers decide which of `projectId` / `teamId` /
   * `organizationId` the input must carry — a missing id, or an id from a
   * tier the permission cannot be granted at, is a compile error naming the
   * problem. The most specific allowed tier present decides the check scope.
   */
  permission<P extends AuthzPermission>(
    permission: P & ValidateDeclaredPermission<P, TInputOut>,
  ): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * The derivation form, for a permission whose tier the input does not name
   * directly: `.permission("organization:manage", { via: "teamId" })` checks
   * the organization the input's team belongs to. `via` must name a required
   * input field whose tier can derive one the permission is grantable at —
   * the derivation is written at the call site, never inferred.
   */
  permission<P extends AuthzPermission>(
    permission: P,
    options: { via: ViaFieldFor<P, TInputOut> },
  ): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * Any one of the permissions is enough, checked at the input's project
   * scope. List the primary surface's permission first — the denial names
   * it, so granting it resolves the refusal whichever feature the caller
   * came through.
   */
  permissionAny<Ps extends readonly [AuthzPermission, ...AuthzPermission[]]>(
    ...permissions: PermissionAnyArgs<Ps, TInputOut>
  ): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * Authenticated, deliberately unchecked — for procedures that read no
   * organization-, team-, or project-scoped data. Requires a written reason,
   * and every scope id the input carries must be individually allowed with
   * one: the legacy `skipPermissionCheck` runtime guard, moved to compile
   * time.
   */
  noPermission(
    options: DeclaredNoPermissionOptions<TInputOut>,
  ): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
  /**
   * The scope is data the handler loads at runtime (a row's own scope set),
   * so the SERVICE performs the real authorization. The declaration records
   * why, and which permissions the service enforces — this only moves WHERE
   * the check happens, never whether one does.
   */
  authorizeInService(options: {
    reason: string;
    permissions: readonly AuthzPermission[];
  }): ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;
}

/**
 * `.permission()` reads its scope id from the validated input, so an input
 * must be declared first — `UnsetMarker` is tRPC's "no .input() yet".
 */
type ValidateDeclaredPermission<
  P extends AuthzPermission,
  I,
> = UnsetMarker extends I
  ? DeclarationError<"declare .input() before .permission() — the check reads its scope id from the validated input">
  : ValidatePermissionForInput<P, I>;

type PermissionAnyArgs<
  Ps extends readonly [AuthzPermission, ...AuthzPermission[]],
  I,
> = UnsetMarker extends I
  ? [
      AuthzPermission &
        DeclarationError<"declare .input() before .permissionAny() — the check reads its projectId from the validated input">,
    ]
  : I extends { projectId: string }
    ? {
        [K in keyof Ps]: Ps[K] &
          ValidatePermissionForInput<Ps[K] & AuthzPermission, I>;
      }
    : [
        AuthzPermission &
          DeclarationError<".permissionAny() checks at the project scope and needs a required 'projectId' in the input">,
      ];

type DeclaredNoPermissionOptions<I> = UnsetMarker extends I
  ? { reason: string; allow?: undefined }
  : NoPermissionOptions<I>;

const permissionProcedureBuilder = <
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TCaller extends boolean,
>(
  procedure: ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >,
): PendingPermissionProcedureBuilder<
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TCaller
> => {
  /** The builder this call returns, named once rather than spelled out at
   *  every cast below — the instantiation is identical in all of them. */
  type Pending = PendingPermissionProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  >;

  /**
   * The one chain both entry points build: the surrounding middlewares are
   * identical and only the permission check in the middle differs, so
   * `.use()` and `.permission()` cannot drift in what wraps them. Order is
   * behaviour — the check must sit inside the error/tracing middlewares and
   * before `enforcePermissionCheck`, which is what proves a check ran at all.
   */
  const withPermissionCheck = (check: unknown) =>
    procedure
      .use(tracerMiddleware as any)
      .use(loggerMiddleware as any)
      .use(handledErrorMiddleware as any)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before ANY declaration kind — declared,
      // custom, or opted-out — can pass on one id while the handler acts on
      // another. See scope-lineage-guard.ts.
      .use(scopeLineageGuard(authzDeclarationOf(check)) as any)
      .use(check as any)
      .use(enforcePermissionCheck as any)
      .use(auditLogMutations as any) as any;

  return {
    input: ((input: Parser) => {
      return permissionProcedureBuilder(procedure.input(input as any));
    }) as Pending["input"],
    use: (middleware) => withPermissionCheck(middleware),
    permission: ((
      permission: AuthzPermission,
      options?: { via?: ScopeTierField },
    ) =>
      withPermissionCheck(
        checkDeclaredPermission({ permission, via: options?.via }),
      )) as Pending["permission"],
    permissionAny: ((...permissions: [AuthzPermission, ...AuthzPermission[]]) =>
      withPermissionCheck(
        checkDeclaredPermissionAny(permissions),
      )) as Pending["permissionAny"],
    noPermission: ((options: {
      reason: string;
      allow?: Record<string, string>;
    }) =>
      withPermissionCheck(
        declaredNoPermission(options),
      )) as Pending["noPermission"],
    authorizeInService: (options) =>
      withPermissionCheck(declaredServiceAuthorization(options)),
  };
};

export const protectedProcedure = permissionProcedureBuilder(
  authProtectedProcedure,
);

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 *
 */
export const publicProcedure = permissionProcedureBuilder(t.procedure);

const authMiddlewares = (
  enforceUserIsAuthed as unknown as { _middlewares: unknown[] }
)._middlewares;

/**
 * Whether a built procedure skips `enforceUserIsAuthed` — i.e. was built from
 * `publicProcedure` and is callable without a session. Backs the
 * public-surface allowlist test, the tripwire that makes adding a new
 * unauthenticated endpoint a deliberate, reviewed act.
 */
export function isPublicProcedure(procedure: unknown): boolean {
  const middlewares =
    (procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares ??
    [];
  return !middlewares.some((middleware) =>
    authMiddlewares.includes(middleware),
  );
}
