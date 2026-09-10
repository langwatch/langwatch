/**
 * The policy spine every tRPC procedure runs through: the ports the process
 * fills, the declared authorization checks, the scope-lineage guard, the
 * builder that makes a declaration mandatory, and the process middlewares those
 * are wrapped in.
 */
import {
  type AuthzDeclaration,
  type AuthzDenialReason,
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzPermission,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
  BlankScopeIdError,
  type DeclarationError,
  type DeclaredAuthzMiddleware,
  type DeclaredScopeId,
  declareAuthzMiddleware,
  type EnforcedScopeFields,
  type NoPermissionOptions,
  type PermissionDecision,
  PermissionDeniedError,
  resolveDeclaredScope,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
  type ValidatePermissionForInput,
  type ViaFieldFor,
  authzDeclarationOf,
} from "@langwatch/authz-contract";
import { HandledError, isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { createLogger, type RequestContext } from "@langwatch/observability";
import { runWithContext } from "@langwatch/observability/context";
import { nowInstant } from "@langwatch/time";
import {
  context as otelContext,
  trace as otelTrace,
  type Span,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { TRPCError } from "@trpc/server";
import type {
  GetRawInputFn,
  inferParser,
  MiddlewareResult,
  Overwrite,
  Parser,
  ProcedureBuilder,
  ProcedureType,
  Simplify,
  UnsetMarker,
} from "@trpc/server/unstable-core-do-not-import";

import {
  auditScopeIds,
  callerTraceContext,
  deriveAuditTarget,
  isAuditLogExempt,
  isSilencedCall,
  redactAuditArgs,
  recordTrpcCall,
  trpcFailureTraceIds,
} from "./audit.ts";
import type { TrpcRoot } from "./runtime.ts";

const authzLogger = createLogger("langwatch:authz");
const trpcLogger = createLogger("langwatch:trpc");

// ─────────────────────────────────────────────────────────────────────────────
// The ports: everything the spine needs from the process it runs in.
//
// The spine owns tracing, request logging, handled-error translation, the
// scope-lineage guard, the declared authorization check, the fail-closed
// backstop and the audit trail. It owns none of the concrete things those need
// — who the caller is, which service decides authorization, where an audit row
// is written, which reporter an unhandled 5xx goes to, or which application
// error classes become a bad request.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The request context as tRPC actually hands it to a middleware.
 *
 * tRPC never gives a middleware the bare context type: it gives that type with
 * its index signatures stripped (`Overwrite<TContext, object>`, flattened by
 * `Simplify`). At runtime the two are the same object, but for a `TContext`
 * that is still a type parameter the compiler cannot prove the mapped form
 * assignable back to it, so a port declared `(ctx: TContext)` cannot be called
 * with what the middleware was given.
 */
export type TrpcMiddlewareContext<TContext> = Simplify<Overwrite<TContext, object>>;

/**
 * The same context, as a middleware installed AFTER the authenticating one
 * receives it: `TContext` with the authenticated shape written over it.
 *
 * The audit middleware sits behind the authentication middleware and still
 * reads the caller, so `actor` is handed this rather than the plain context.
 */
export type TrpcAuthenticatedMiddlewareContext<TContext, TAuthenticatedContext> = Simplify<
  Overwrite<TContext, Overwrite<object, TAuthenticatedContext>>
>;

/**
 * The request as the spine reads it: headers for the caller's trace context,
 * user agent, and the client address the audit trail records. Deliberately
 * not a Node request type — the callers range from an HTTP request to a
 * WebSocket handshake to nothing at all.
 */
export type TrpcRequestHeaders = Record<string, string | string[] | undefined> & {
  /**
   * Named because the request log records it as one string. Left to the index
   * signature it would read as `string | string[]`, which the log line is not.
   */
  "user-agent"?: string;
};

export type TrpcRequestLike = {
  headers: TrpcRequestHeaders;
  socket?: { remoteAddress?: string };
};

/** The response as the spine reads it: only the status the log line records. */
export type TrpcResponseLike = { statusCode?: number };

/**
 * The one identity the spine attributes a call to. `impersonatorId` is the
 * real admin when an admin is acting as someone else: `id` stays the
 * impersonated user, because that is who the authorization decision is about,
 * and the audit row stamps the human who actually clicked.
 */
export type TrpcActor = Readonly<{ id: string; impersonatorId?: string }>;

/** Reads the actor off a request context. */
export interface TrpcActorPort<TContext> {
  actor(ctx: TrpcMiddlewareContext<TContext>): TrpcActor | undefined;
}

/**
 * Identity, as the authenticated procedure needs it.
 *
 * `authenticate` both refuses an anonymous caller and answers the context
 * override the rest of the chain sees, so the process keeps ownership of its
 * own session shape.
 */
export interface TrpcIdentity<
  TContext,
  TAuthenticatedContext extends object,
> extends TrpcActorPort<TContext> {
  authenticate(ctx: TrpcMiddlewareContext<TContext>): TAuthenticatedContext;
  /**
   * Widened from `TrpcActorPort`: the audit middleware reads the caller from
   * behind the authentication middleware, where the context carries the
   * authenticated shape. Both spellings are the same object.
   */
  actor(
    ctx:
      | TrpcMiddlewareContext<TContext>
      | TrpcAuthenticatedMiddlewareContext<TContext, TAuthenticatedContext>,
  ): TrpcActor | undefined;
}

/** One audit row, as the spine describes it. */
export type TrpcAuditEntry = Readonly<{
  userId: string;
  organizationId?: string;
  projectId?: string;
  /** The tRPC path, which is also what the redaction rules are keyed by. */
  action: string;
  args?: unknown;
  error?: Error;
  req?: TrpcRequestLike;
  metadata?: Record<string, string>;
  targetKind?: string;
  targetId?: string;
}>;

/** Where an audit row is written. */
export interface TrpcAudit {
  record(entry: TrpcAuditEntry): Promise<void>;
}

/**
 * Where an unhandled server fault is reported, and how an unknown failure
 * becomes an Error. Both belong to the process, which already owns the one
 * coercion rule the rest of the application uses.
 */
export interface TrpcErrorReporting {
  capture(failure: unknown): void;
  asError(failure: unknown): Error;
}

/** The tRPC code and message one application error class answers with. */
export type TrpcTranslatedCause = Readonly<{
  code: TRPCError["code"];
  message: string;
}>;

/**
 * Application error classes this package does not own but must still answer
 * correctly for. A handled error states its own status and needs no entry
 * here; this is for the typed causes a process re-raises with a code of its
 * own so a client interceptor can act on them.
 */
export interface TrpcCauseTranslation {
  translate(cause: unknown): TrpcTranslatedCause | undefined;
}

/** The authorization decisions the spine asks for, and nothing else. */
export interface TrpcAuthorizationDecisions {
  getDecision(input: AuthzGetDecisionInput): Promise<PermissionDecision>;
  getProjectAnyDecision(input: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision>;
  checkScopeLineage(input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult>;
}

/**
 * Resolves the authorization service for one request.
 *
 * A resolver rather than a value, because the decisions are request scoped:
 * the process composes them per request and this package must not reach for a
 * process-wide one.
 */
export interface TrpcAuthorization<TContext> {
  forRequest(ctx: TrpcMiddlewareContext<TContext>): TrpcAuthorizationDecisions;
}

/**
 * The two refusals whose concrete error class is the process's to choose.
 *
 * The denial SHAPE is this package's — which condition is answered first, and
 * that both answer UNAUTHORIZED with the domain error as the cause — but the
 * classes themselves carry product copy and codes a client renders.
 */
export interface TrpcAuthorizationDenial {
  /** The membership exists but an admin disabled it, so it grants nothing. */
  membershipDisabled(): Error;
  /** The organization role does not reach this feature at all. */
  liteMemberRestricted(resource: string): Error;
}

/**
 * The part of a process's tRPC context the policy spine reads directly.
 *
 * Everything the spine could reach through a service on the context arrives
 * as a port instead. What is left is the transport itself — the request and
 * response the log line and the audit row describe — plus the one flag the
 * fail-closed backstop exists to read.
 */
export interface TrpcPolicyContext {
  readonly req?: TrpcRequestLike | undefined;
  readonly res?: TrpcResponseLike | undefined;
  /**
   * Set by a declared authorization check, read by `enforcePermissionCheck`.
   * A procedure that reaches its resolver with this still false was never
   * checked, which is a refusal rather than a pass.
   */
  readonly permissionChecked: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Declared authorization: ADR-092 §5, the tRPC adapter behind the typed
// declaration surface. `protectedProcedure.input(…).permission("…")` compiles
// down to the middleware built here.
//
// Every decision is asked of the authorization port the process resolves per
// request. What IS deliberately part of this seam is the denial shape: every
// tier's refusal carries the engine's one handled code. Every middleware built
// here carries an `AUTHZ_DECLARATION` descriptor, the machine-readable half of
// the declaration, which the router sweep reads.
// ─────────────────────────────────────────────────────────────────────────────

type ScopeInput = Partial<Record<ScopeTierField, unknown>>;

/**
 * The organization role a decision reports, as this package needs it. Kept as
 * a plain string so a process whose context types the role with its own enum
 * satisfies the contract without this package importing that enum.
 */
export type TrpcOrganizationRole = string;

/**
 * What a declared check writes back onto the request context.
 *
 * `permissionChecked` is what `enforcePermissionCheck` reads: a procedure that
 * reaches its resolver without it was never checked. `organizationRole` is the
 * legacy carry-forward the project and team resolutions leave for downstream
 * code.
 */
export interface TrpcDeclaredAuthzContext {
  permissionChecked: boolean;
  organizationRole?: TrpcOrganizationRole | null;
}

/**
 * `any` here is load-bearing, not laziness: tRPC's `.use()` requires a
 * middleware whose return is assignable to its own `MiddlewareResult`, and a
 * declared check is written against the scope input rather than against one
 * procedure's generics.
 */
type DeclaredCheckNext = () => any;

export type TrpcDeclaredCheckParams<TContext> = {
  ctx: TrpcMiddlewareContext<TContext>;
  input: ScopeInput;
  next: DeclaredCheckNext;
};

/**
 * What a check that reads nothing but the request context is handed.
 *
 * Naming `input` is what makes a check installable ONLY after a procedure's own
 * `.input()` parser: before one runs, tRPC types the validated input as its
 * `UnsetMarker`, which no scope shape accepts. `authorizeInService` reads no id
 * at all, so omitting the field here says so.
 */
export type TrpcContextOnlyCheckParams<TContext> = {
  ctx: TrpcMiddlewareContext<TContext>;
  next: DeclaredCheckNext;
};

/**
 * One declared check: the middleware, carrying the machine-readable
 * declaration the router sweep reads. `declareAuthzMiddleware(...)` is the only
 * way to produce the brand, so an undeclared function cannot stand in for one.
 */
export type TrpcDeclaredCheck<TContext> = DeclaredAuthzMiddleware<
  (params: TrpcDeclaredCheckParams<TContext>) => Promise<any>
>;

/** The same, for a check that reads no validated input. */
export type TrpcContextOnlyDeclaredCheck<TContext> = DeclaredAuthzMiddleware<
  (params: TrpcContextOnlyCheckParams<TContext>) => Promise<any>
>;

const SENSITIVE_SCOPE_FIELDS = Object.values(SCOPE_TIER_FIELDS) as ScopeTierField[];

/**
 * The four builders one process's declared checks are made of.
 *
 * Deliberately not parameterised on the request context: what the chain needs
 * back is an installed check, and naming the context here would make every
 * process's own middleware shape part of the contract.
 */
export interface TrpcDeclaredAuthzMiddlewares<TContext> {
  permission(
    input: Readonly<{ permission: AuthzPermission; via?: ScopeTierField }>,
  ): TrpcDeclaredCheck<TContext>;
  permissionAny(
    permissions: readonly [AuthzPermission, ...AuthzPermission[]],
  ): TrpcDeclaredCheck<TContext>;
  noPermission(
    options: Readonly<{ reason: string; allow?: Record<string, string> }>,
  ): TrpcDeclaredCheck<TContext>;
  serviceAuthorized(
    options: Readonly<{
      reason: string;
      permissions: readonly AuthzPermission[];
      enforces?: EnforcedScopeFields;
    }>,
  ): TrpcContextOnlyDeclaredCheck<TContext>;
}

export type TrpcDeclaredAuthzPorts<TContext> = Readonly<{
  identity: TrpcActorPort<TContext>;
  authorization: TrpcAuthorization<TContext>;
  denials: TrpcAuthorizationDenial;
}>;

/**
 * Writes through the narrow context this package owns rather than through the
 * process's own type parameter: a write to a generic's property is not
 * expressible, and widening the parameter would let a caller pass a context
 * these checks were never meant to mutate.
 */
function markPermissionChecked(ctx: TrpcDeclaredAuthzContext): void {
  ctx.permissionChecked = true;
}

function rememberOrganizationRole(
  ctx: TrpcDeclaredAuthzContext,
  organizationRole: TrpcOrganizationRole | null,
): void {
  ctx.organizationRole = organizationRole;
}

export function createDeclaredAuthzMiddlewares<TContext extends TrpcDeclaredAuthzContext>(
  ports: TrpcDeclaredAuthzPorts<TContext>,
): TrpcDeclaredAuthzMiddlewares<TContext> {
  /**
   * `.permission(p)` / `.permission(p, { via })`. The type layer guarantees the
   * input carries a usable id; the runtime re-derives the same answer and still
   * fails loudly if the two ever disagree.
   */
  const permission = ({
    permission: required,
    via,
  }: Readonly<{
    permission: AuthzPermission;
    via?: ScopeTierField;
  }>): TrpcDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      { kind: "permission", permission: required, via },
      async ({ ctx, input, next }: TrpcDeclaredCheckParams<TContext>) => {
        // A public procedure exposes `.permission()` too, so a session is not
        // a given. Answering "unauthenticated" before any id is looked at
        // keeps an anonymous caller from learning anything about the scope.
        const actor = ports.identity.actor(ctx);
        if (!actor) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const scope = requireDeclaredScope({ permission: required, input, via });
        const { permitted, organizationRole, denialReason } = await ports.authorization
          .forRequest(ctx)
          .getDecision({
            userId: actor.id,
            permission: required,
            scope,
          });
        if (!permitted) {
          throw deniedError({
            permission: required,
            scope,
            organizationRole,
            denialReason,
            denials: ports.denials,
          });
        }
        // Legacy parity: the organization tier never carried a role onto the
        // context, so only the project/team resolutions (non-null role) do.
        if (organizationRole !== null) {
          rememberOrganizationRole(ctx, organizationRole);
        }

        markPermissionChecked(ctx);
        return next();
      },
    );

  /**
   * `.permissionAny(…)` — any one of the permissions is enough, checked at the
   * input's project scope. One scope resolution serves every candidate; the
   * denial names the FIRST permission, so callers list the primary surface
   * first.
   */
  const permissionAny = (
    permissions: readonly [AuthzPermission, ...AuthzPermission[]],
  ): TrpcDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      { kind: "permission-any", permissions },
      async ({ ctx, input, next }: TrpcDeclaredCheckParams<TContext>) => {
        const actor = ports.identity.actor(ctx);
        if (!actor) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        // Always the project tier, so the field is named outright — but read
        // through the same resolution the single-permission seam uses, so the
        // blank-versus-missing split is decided in exactly one place.
        const { id: projectId } = requireDeclaredScope({
          permission: permissions[0],
          input,
          via: "projectId",
        });
        const { permitted, organizationRole, denialReason } = await ports.authorization
          .forRequest(ctx)
          .getProjectAnyDecision({
            userId: actor.id,
            projectId,
            permissions,
          });
        if (!permitted) {
          throw deniedError({
            permission: permissions[0],
            scope: { tier: "project", id: projectId },
            organizationRole,
            denialReason,
            denials: ports.denials,
          });
        }
        rememberOrganizationRole(ctx, organizationRole);
        markPermissionChecked(ctx);
        return next();
      },
    );

  /**
   * `.noPermission({ reason, allow })` — authenticated, deliberately
   * unchecked. The type layer refuses scoped input fields that are not
   * individually allowed with a reason; this runtime guard is the defense in
   * depth behind it.
   */
  const noPermission = ({
    reason,
    allow,
  }: Readonly<{
    reason: string;
    allow?: Record<string, string>;
  }>): TrpcDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      { kind: "no-permission", reason, allow },
      async ({ ctx, input, next }: TrpcDeclaredCheckParams<TContext>) => {
        const allowedKeys = Object.keys(allow ?? {});
        for (const key of SENSITIVE_SCOPE_FIELDS) {
          if (key in input && !allowedKeys.includes(key)) {
            throw new Error(`${key} is not allowed to be used without permission check`);
          }
        }
        markPermissionChecked(ctx);
        return next();
      },
    );

  /**
   * `.authorizeInService({ reason, permissions, enforces })` — the scope is
   * data the handler loads at runtime, so the SERVICE performs the real
   * authorization and the declaration records which permissions it enforces.
   *
   * `enforces` names, per scope field, WHAT in the resolver enforces it. The
   * sweep counts a claimed field as covered, so it has to survive this hop.
   */
  const serviceAuthorized = ({
    reason,
    permissions,
    enforces,
  }: Readonly<{
    reason: string;
    permissions: readonly AuthzPermission[];
    enforces?: EnforcedScopeFields;
  }>): TrpcContextOnlyDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      {
        kind: "service-authorized",
        reason,
        permissions,
        ...(enforces === undefined ? {} : { enforces }),
      },
      async ({ ctx, next }: TrpcContextOnlyCheckParams<TContext>) => {
        markPermissionChecked(ctx);
        return next();
      },
    );

  return { permission, permissionAny, noPermission, serviceAuthorized };
}

function requireDeclaredScope({
  permission,
  input,
  via,
}: {
  permission: AuthzPermission;
  input: ScopeInput;
  via?: ScopeTierField;
}): DeclaredScopeId {
  const resolution = resolveDeclaredScope({ permission, input, via });
  if (resolution.resolved) return resolution.scope;
  if (resolution.unresolved.reason === "blank") {
    throw blankScopeId({ field: resolution.unresolved.field });
  }
  throw wiringBug({ permission, via });
}

/**
 * The caller named the scope field and left it empty. Answered as the bad
 * request it is, rather than as the wiring bug below: a blank id is something
 * the caller can fix, and reporting it as an internal error both misleads them
 * and pages us for their typo.
 */
function blankScopeId({ field }: { field: string }): TRPCError {
  const blank = new BlankScopeIdError({ field });
  return new TRPCError({
    code: "BAD_REQUEST",
    message: blank.message,
    cause: blank,
  });
}

/**
 * The input names no scope field at all. Nothing the caller did can fix that,
 * so the sentence they read says only that; which procedure is miswired goes
 * to the log. The types make this unreachable — this is the runtime backstop
 * for the day they are bypassed.
 *
 * A field that is present and empty is NOT this: that case answers through
 * `blankScopeId`.
 */
function wiringBug({
  permission,
  via,
}: {
  permission: AuthzPermission;
  via?: ScopeTierField;
}): TRPCError {
  authzLogger.error({ permission, via }, "declared permission's input carries no usable scope id");
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong. Please try again.",
  });
}

/**
 * The one denial shape for every tier. An id that resolves to nothing
 * answers exactly like an id the caller may not touch — the resolvers
 * already fold both into `permitted: false`, so no probe can learn whether a
 * scope EXISTS.
 */
function deniedError({
  permission,
  scope,
  organizationRole,
  denialReason,
  denials,
}: {
  permission: AuthzPermission;
  scope: DeclaredScopeId;
  organizationRole: TrpcOrganizationRole | null;
  denialReason?: AuthzDenialReason;
  denials: TrpcAuthorizationDenial;
}): TRPCError {
  // Checked before the role, because a disabled member HAS a role and the
  // role-shaped answers would all be wrong for them: the lite-member modal
  // offers an upgrade they cannot buy, and the generic denial names a
  // permission nobody can grant them while the seat is off.
  if (denialReason === "membership-disabled") {
    const disabled = denials.membershipDisabled();
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: disabled.message,
      cause: disabled,
    });
  }
  // String comparison on purpose: a VALUE import of the organization role enum
  // would put the generated Prisma client on this module's graph for one
  // constant.
  if (organizationRole === "EXTERNAL") {
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "This feature is not available for your account",
      cause: denials.liteMemberRestricted(permission.split(":")[0] ?? "unknown"),
    });
  }
  const denied = new PermissionDeniedError({
    permission,
    scope: { type: scope.tier, id: scope.id },
    denialReason: denialReason ?? "no-binding",
  });
  // The wire code that results is FORBIDDEN, not the UNAUTHORIZED spelled
  // here: `handledErrorMiddleware` re-derives it from the handled cause's
  // `httpStatus` (403) — the caller IS authenticated, they just lack the
  // permission.
  return new TRPCError({
    code: "UNAUTHORIZED",
    message: denied.message,
    cause: denied,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The scope-lineage guard: a request mixing scope ids across organizations is
// refused before any declaration kind can pass on one id while the handler acts
// on another.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The middleware's own parameters, annotated rather than inferred.
 *
 * tRPC hands a middleware `Simplify<WithoutIndexSignature<TContext>>`, which is
 * a runtime identity for a plain object type but which the compiler cannot
 * prove assignable back to an unresolved `TContext`. Inferring `ctx` here and
 * passing it to a port that wants `TContext` fails in a way that cascades: the
 * enclosing procedure builder stops resolving and every callback downstream
 * loses its contextual types.
 */
type ScopeLineageParams<TContext> = {
  ctx: TrpcMiddlewareContext<TContext>;
  input: unknown;
  next: () => any;
};

/**
 * Deliberately NOT `TRPCMiddlewareFunction`: naming tRPC's own type in the
 * return position re-imposes the mapped context and the assignment fails
 * again. `any` in the result mirrors `DeclaredCheckNext` above.
 */
type ScopeLineageMiddleware<TContext> = (params: ScopeLineageParams<TContext>) => Promise<any>;

function asScopeLineageInput(input: unknown): AuthzScopeLineageInput {
  return typeof input === "object" && input !== null ? input : {};
}

function declaredPermissionOf(declaration: AuthzDeclaration | null): string {
  switch (declaration?.kind) {
    case "permission":
      return declaration.permission;
    case "permission-any":
    case "custom":
    case "service-authorized":
      return declaration.permissions[0] ?? "";
    default:
      return "";
  }
}

/**
 * Keeps the tRPC boundary limited to input extraction and error shaping. AuthZ
 * resolves scope lineage through its composed repository and fails closed.
 */
export function createScopeLineageGuard<TContext>(
  ports: Readonly<{ authorization: TrpcAuthorization<TContext> }>,
): (declaration: AuthzDeclaration | null) => ScopeLineageMiddleware<TContext> {
  return (declaration) =>
    async ({ ctx, input, next }: ScopeLineageParams<TContext>) => {
      const lineage = await ports.authorization
        .forRequest(ctx)
        .checkScopeLineage(asScopeLineageInput(input));
      if (lineage.kind === "consistent") {
        return next();
      }

      const { widest } = lineage;
      const denied = new PermissionDeniedError({
        permission: declaredPermissionOf(declaration),
        scope: { type: widest.tier, id: widest.id },
        denialReason: "no-membership",
      });

      throw new TRPCError({
        // The handled-error middleware derives the wire status from this cause.
        code: "UNAUTHORIZED",
        message: denied.message,
        cause: denied,
      });
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// The permission procedure builder: an authorization declaration made
// mandatory by construction.
//
// After `.input()` a pending builder exposes only `input`, `use`, `permission`,
// `permissionAny`, `noPermission` and `authorizeInService` — and none of
// `.query` / `.mutation` / `.subscription`. An undeclared procedure is
// therefore not a lint finding or a sweep failure: it does not compile.
// ─────────────────────────────────────────────────────────────────────────────

type OverwriteIfDefined<TType, TWith> = UnsetMarker extends TType ? TWith : Simplify<TType & TWith>;

/**
 * The parameter shape a hand-written declared check receives. Supplied by the
 * process as `TCheckContext`, because a custom check reads the process's own
 * request context and this package must not invent one for it.
 *
 * `any` is load-bearing on both `next` and the return: tRPC's `.use()` accepts
 * a middleware whose result is assignable to its own `MiddlewareResult`, which
 * a check written against validated input cannot name.
 */
export type TrpcCheckMiddleware<TCheckContext, TInput> = (params: {
  ctx: TCheckContext;
  input: TInput;
  next: () => any;
}) => Promise<any>;

/**
 * The process middlewares wrapped around every declared procedure. Opaque on
 * purpose: tRPC's middleware generics belong to the root that produced them,
 * and this module only ever hands them back to that same root's builders.
 */
export type TrpcPolicyChainMiddlewares = Readonly<{
  tracer: unknown;
  logger: unknown;
  handledError: unknown;
  /** Refuses a request whose scope ids do not resolve to one organization. */
  scopeLineageGuard(declaration: AuthzDeclaration | null): unknown;
  /** The fail-closed backstop: refuses a procedure no check ever ran on. */
  enforceCheck: unknown;
  /** Writes the audit row for a mutation. */
  auditMutations: unknown;
}>;

/**
 * Typescript hackery to make sure all endpoints are forced to set the input, then to explicitly tell
 * a permission check middleware to use, and that this permission check should be compatible with the
 * inputs required
 */
export interface PendingPermissionProcedureBuilder<
  TCheckContext,
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
    TCheckContext,
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
    middleware: DeclaredAuthzMiddleware<TrpcCheckMiddleware<TCheckContext, TInputOut>>,
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
type ValidateDeclaredPermission<P extends AuthzPermission, I> = UnsetMarker extends I
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
        [K in keyof Ps]: Ps[K] & ValidatePermissionForInput<Ps[K] & AuthzPermission, I>;
      }
    : [
        AuthzPermission &
          DeclarationError<".permissionAny() checks at the project scope and needs a required 'projectId' in the input">,
      ];

type DeclaredNoPermissionOptions<I> = UnsetMarker extends I
  ? { reason: string; allow?: undefined }
  : NoPermissionOptions<I>;

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose generics belong to
 * the caller, so nothing below needs `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * What installing a check into the chain actually requires: the declaration
 * brand, and nothing else.
 *
 * The chain builder below reads the descriptor off the check and hands the
 * function to `.use()`; it never calls it, so the context and validated-input
 * types the check is written against are the CALLER's business, checked on the
 * public `.use()` above against that procedure's own generics.
 *
 * The brand is the invariant that matters and it survives: only
 * `declareAuthzMiddleware(...)` produces it, so an undeclared function is
 * still a compile error rather than a sweep finding.
 */
type InstallableCheck = DeclaredAuthzMiddleware<(params: never) => Promise<unknown>>;

/**
 * Builds one process's declaring procedure builder.
 *
 * `TCheckContext` is the request context a hand-written custom check receives
 * through `.use()`. It is the process's, named once here, so this package
 * never has to know what else rides on that context.
 */
export function createPermissionProcedureBuilder<TCheckContext, TDeclaredContext>(
  middlewares: TrpcPolicyChainMiddlewares,
  checks: TrpcDeclaredAuthzMiddlewares<TDeclaredContext>,
) {
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
    TCheckContext,
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    TCaller
  > => {
    /** The builder this call returns, named once at the tRPC type boundary. */
    type Pending = PendingPermissionProcedureBuilder<
      TCheckContext,
      TContext,
      TMeta,
      TContextOverrides,
      TInputIn,
      TInputOut,
      TOutputIn,
      TOutputOut,
      TCaller
    >;

    /** What every declaring method answers: the plain tRPC builder again. */
    type Declared = ProcedureBuilder<
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
     * The one chain every entry point builds: the surrounding middlewares are
     * identical and only the permission check in the middle differs, so
     * `.use()` and `.permission()` cannot drift in what wraps them. Order is
     * behaviour — the check must sit inside the error/tracing middlewares and
     * before `enforceCheck`, which is what proves a check ran at all.
     */
    const withPermissionCheck = (check: InstallableCheck): Declared =>
      (procedure as unknown as ChainableProcedure)
        .use(middlewares.tracer)
        .use(middlewares.logger)
        .use(middlewares.handledError)
        // Ahead of the check on purpose: a request mixing scope ids across
        // organizations is refused before ANY declaration kind — declared,
        // custom, or opted-out — can pass on one id while the handler acts on
        // another. AuthZ owns the lineage decision; this is its tRPC adapter.
        .use(middlewares.scopeLineageGuard(authzDeclarationOf(check)))
        .use(check)
        .use(middlewares.enforceCheck)
        .use(middlewares.auditMutations) as unknown as Declared;

    const builder = {
      input(input: Parser) {
        // tRPC types `.input()` as a conditional on the input already
        // accumulated, and this builder forwards for a procedure whose input
        // is a type parameter — the conditional never resolves, so it lands
        // on the framework's `TypeError<…>` branch. The cast is on the
        // FORWARDING seam only: the parser reaching tRPC is the caller's own,
        // and the builder returned re-derives its types from the result.
        return permissionProcedureBuilder(
          procedure.input(input as Parameters<typeof procedure.input>[0]),
        );
      },
      use(middleware: DeclaredAuthzMiddleware<TrpcCheckMiddleware<TCheckContext, TInputOut>>) {
        return withPermissionCheck(middleware);
      },
      permission(permission: AuthzPermission, options?: { via?: ScopeTierField }) {
        return withPermissionCheck(checks.permission({ permission, via: options?.via }));
      },
      permissionAny(...permissions: [AuthzPermission, ...AuthzPermission[]]) {
        return withPermissionCheck(checks.permissionAny(permissions));
      },
      noPermission(options: { reason: string; allow?: Record<string, string> }) {
        return withPermissionCheck(checks.noPermission(options));
      },
      authorizeInService(options: { reason: string; permissions: readonly AuthzPermission[] }) {
        return withPermissionCheck(checks.serviceAuthorized(options));
      },
    };

    // tRPC v11 has no public extension point for a procedure builder's extra
    // fluent methods. This is the sole audited structural boundary: every
    // method above delegates to the same concrete builder and keeps its exact
    // context, input, output, and caller generics.
    return builder as Pending;
  };

  return permissionProcedureBuilder;
}

function middlewareList(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null || !("_middlewares" in value)) {
    return [];
  }

  const middlewares = value._middlewares;
  return Array.isArray(middlewares) ? middlewares : [];
}

/**
 * A built procedure is a **callable** carrying `_def`, not a plain object:
 * tRPC's `createResolver` returns the invoker itself. Reading it as an object
 * answered `[]` for every procedure in the router, which made
 * `isPublicProcedure` below say "public" about all of them.
 *
 * Unreadable is thrown rather than returned as empty. The one thing this
 * function must never do is shrug: an empty list reads as "no auth middleware
 * here", so a shape it does not understand would report the whole surface
 * anonymous, or — with the sense inverted — hide a genuinely public endpoint.
 */
function procedureMiddlewareList(value: unknown): readonly unknown[] {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new Error(`Not a tRPC procedure: ${typeof value}`);
  }
  if (!("_def" in value)) {
    throw new Error("tRPC procedure carries no `_def` to read its middlewares from");
  }

  const definition = (value as { _def: unknown })._def;
  if (typeof definition !== "object" || definition === null || !("middlewares" in definition)) {
    throw new Error("tRPC procedure `_def` carries no `middlewares` list");
  }

  const middlewares = (definition as { middlewares: unknown }).middlewares;
  if (!Array.isArray(middlewares)) {
    throw new Error("tRPC procedure `_def.middlewares` is not a list");
  }
  return middlewares;
}

/**
 * Whether a built procedure skips the process's authentication middleware —
 * i.e. was built from the public procedure and is callable without a session.
 * Backs the public-surface allowlist test, the tripwire that makes adding a
 * new unauthenticated endpoint a deliberate, reviewed act.
 */
export function createIsPublicProcedure(
  enforceUserIsAuthed: unknown,
): (procedure: unknown) => boolean {
  const authMiddlewares = middlewareList(enforceUserIsAuthed);
  return (procedure: unknown) => {
    const middlewares = procedureMiddlewareList(procedure);
    return !middlewares.some((middleware) => authMiddlewares.includes(middleware));
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The process middlewares every tRPC procedure is wrapped in, built once from
// a root and the ports the process fills.
//
// ORDER IS BEHAVIOUR. The chain a declared procedure runs is tracer, logger,
// handled-error, scope-lineage guard, declared check, `enforcePermissionCheck`,
// audit — and each of the last four reads the VALIDATED input, so the chain is
// applied after a procedure's own `.input()` parser, never before it.
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the process supplies for the policy below to exist. */
export type TrpcRuntimePolicyPorts<TContext, TAuthenticatedContext extends object> = Readonly<{
  identity: TrpcIdentity<TContext, TAuthenticatedContext>;
  audit: TrpcAudit;
  errorReporting: TrpcErrorReporting;
  causes: TrpcCauseTranslation;
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
 * `langwatch.error.code` / `langwatch.error.fault` mirror the fields
 * `handleTrpcCallLogging` writes, so support can filter traces by the same
 * facts they filter logs by. Span status stays UNSET for a customer-fault
 * handled error: a 404 for a row someone deleted is the system working, and
 * marking it ERROR counts routine refusals against every SLO built on span
 * status. Platform and provider faults still set ERROR.
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
    // refusal. The domain status survives as `data.error.httpStatus`, and the
    // client keys its copy off `code`.
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
    // routers already used for a still-preparing dataset. Without the entry it
    // would fall through to INTERNAL_SERVER_ERROR and report a normal
    // user-induced race as a server fault.
    425: "PRECONDITION_FAILED",
    429: "TOO_MANY_REQUESTS",
    // 502/503/504 have no key in tRPC v10's code table (added in v11), so an
    // upstream failure has to fall through to INTERNAL_SERVER_ERROR here. The
    // domain status survives on the wire as `data.error.httpStatus`, and
    // `handleTrpcCallLogging` records the handled status rather than this one.
  };
  // Every 4xx a handled error raises needs a line here. The fallback is
  // INTERNAL_SERVER_ERROR, so a missing entry books a customer-side refusal as
  // a server fault. 5xx are deliberately left to the fallback.
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
   * The two middlewares the authenticated procedure is built from are written
   * as plain functions and only then wrapped with `root.middleware(...)`.
   *
   * `root.middleware(fn)` answers a builder whose `_middlewares` is `[fn]`, and
   * `procedure.use(fn)` appends `fn` itself, so a procedure built from either
   * carries the SAME function instance: the chain, its order, and the identity
   * `createIsPublicProcedure` compares against are unchanged. What the function
   * form buys is that `procedure.use(...)` type-checks it against
   * `MiddlewareFunction`, which names the context as `TContext`, rather than
   * against `MiddlewareBuilder`, which names it as `Overwrite<TContext, …>`.
   */
  type AuthenticateParams = {
    ctx: TrpcMiddlewareContext<TContext>;
    next: <$ContextOverride>(opts: {
      ctx: $ContextOverride;
    }) => Promise<MiddlewareResult<$ContextOverride>>;
  };

  /**
   * Enforces users are logged in before running the procedure. The narrowed
   * context is the process's own — it decides what a signed-in caller looks
   * like downstream, not this package.
   */
  const authenticate = ({
    ctx,
    next,
  }: AuthenticateParams): Promise<MiddlewareResult<TAuthenticatedContext>> =>
    next({ ctx: ports.identity.authenticate(ctx) });

  /** The same middleware, as the reusable builder other mounts install. */
  const enforceUserIsAuthed = root.middleware(authenticate);

  const enforcePermissionCheck = root.middleware(({ ctx, next }) => {
    if (!ctx.permissionChecked) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Permission check is required",
      });
    }
    return next();
  });

  type AuditErrorsParams = {
    ctx:
      | TrpcMiddlewareContext<TContext>
      | TrpcAuthenticatedMiddlewareContext<TContext, TAuthenticatedContext>;
    path: string;
    type: ProcedureType;
    input: unknown;
    getRawInput: GetRawInputFn;
    next: () => Promise<MiddlewareResult<object>>;
  };

  const auditErrors = async ({ ctx, next, path, type, input, getRawInput }: AuditErrorsParams) => {
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
        // filter on `metadata.impersonatorId`.
        metadata: actor.impersonatorId ? { impersonatorId: actor.impersonatorId } : undefined,
      });
    }

    return result;
  };

  /** The same middleware, as the reusable builder other mounts install. */
  const auditLogTRPCErrors = root.middleware(auditErrors);

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
      const startTime = nowInstant().epochMilliseconds;
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
   * A cause the process re-raises with a code of its own is answered through
   * the cause translation port, because those classes are the application's.
   *
   * A bare `ZodError` — a `.parse` inside a service, not the procedure's own
   * `.input()` parser — is promoted the same way the REST door already promotes
   * it. Without the branch it stays INTERNAL_SERVER_ERROR: the customer still
   * read the right copy, while the log line, the span status and every alert
   * built on them booked a customer's typo as one of our 500s. Matched by
   * shape, not by class: routes and services on this process validate with
   * whichever zod major their schema was authored against.
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

    if (isZodLikeError(cause)) {
      // `ValidationError.fromZodError` is the same promotion the error
      // formatter performs, so the serialised payload on the wire is byte for
      // byte what it already was — only `data.code` and the HTTP status change.
      const validation = ValidationError.fromZodError(cause);
      throw new TRPCError({
        code: handledErrorToTRPCCode(validation),
        // The code, not `validation.message`: zod's `message` is the whole
        // issue array as JSON, and this string is what the span and the log
        // record carry. The wire message is the code either way (#5984).
        message: validation.code,
        cause: validation,
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
      const start = nowInstant().epochMilliseconds;
      // IMPORTANT: In tRPC v10, next() never throws. Downstream errors are
      // caught by callRecursive and returned as { ok: false, error } result
      // objects. Use result.ok to detect errors — NOT try/catch.
      const result = await next();
      const duration = nowInstant().epochMilliseconds - start;

      recordTrpcCall({
        result,
        path,
        type,
        duration,
        userAgent: ctx.req?.headers["user-agent"] ?? null,
        statusCode: ctx.res?.statusCode ?? null,
        log: trpcLogger,
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
  const authProtectedProcedure = root.procedure.use(authenticate).use(auditErrors);

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
