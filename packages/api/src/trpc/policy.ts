/**
 * The policy spine every tRPC procedure runs through: ports, declared
 * authorization checks, the scope-lineage guard, and the mandatory builder.
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
  findAuthzDeclaration,
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

// The ports: the spine owns tracing, logging, error handling, authorization, and the
// fail-closed backstop; it delegates concrete implementations

/** Context with index signatures stripped by tRPC; runtime identical but type-incompatible
 * (see `Overwrite<TContext, object>`) */
export type TrpcMiddlewareContext<TContext> = Simplify<Overwrite<TContext, object>>;

/** Context after authenticating middleware; `actor` is handed this for the audit trail */
export type TrpcAuthenticatedMiddlewareContext<TContext, TAuthenticatedContext> = Simplify<
  Overwrite<TContext, Overwrite<object, TAuthenticatedContext>>
>;

/** Request headers (trace context, user agent, client address); not a Node type */
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
 * `impersonatorId` is the real admin acting as someone else; `id` stays the
 * impersonated user, since that is who the authorization decision is about.
 */
export type TrpcActor = Readonly<{ id: string; impersonatorId?: string }>;

/** Reads the actor off a request context. */
export interface TrpcActorReader<TContext> {
  actor(ctx: TrpcMiddlewareContext<TContext>): TrpcActor | undefined;
}

/**
 * `authenticate` refuses an anonymous caller and answers the context override
 * the rest of the chain sees, so the process keeps its own session shape.
 */
export interface TrpcIdentity<
  TContext,
  TAuthenticatedContext extends object,
> extends TrpcActorReader<TContext> {
  authenticate(ctx: TrpcMiddlewareContext<TContext>): TAuthenticatedContext;
  /**
   * Widened from `TrpcActorReader`: the audit middleware reads the caller from
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
 * for. A handled error needs no entry here; this is for typed causes a
 * process re-raises with a code a client interceptor can act on.
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
 * A resolver rather than a value: decisions are request scoped, so the
 * process composes them per request instead of reaching for a process-wide one.
 */
export interface TrpcAuthorization<TContext> {
  forRequest(ctx: TrpcMiddlewareContext<TContext>): TrpcAuthorizationDecisions;
}

/**
 * The denial SHAPE is this package's — which condition is answered first, and
 * that both answer UNAUTHORIZED with the domain error as cause — but the
 * concrete error classes are the process's to choose, carrying its own copy.
 */
export interface TrpcAuthorizationDenial {
  /** The membership exists but an admin disabled it, so it grants nothing. */
  membershipDisabled(): Error;
  /** The organization role does not reach this feature at all. */
  liteMemberRestricted(resource: string): Error;
}

/**
 * Everything the spine could reach through a service on the context arrives
 * as a port instead; what remains is the transport itself plus the one flag
 * the fail-closed backstop exists to read.
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

// Declared authorization: tRPC adapter (ADR-092 §5); every decision asks the auth port;
// denial shape deliberately standardized with machine-readable descriptor

type ScopeInput = Partial<Record<ScopeTierField, unknown>>;

/**
 * The organization role a decision reports, as this package needs it. Kept as
 * a plain string so a process whose context types the role with its own enum
 * satisfies the contract without this package importing that enum.
 */
export type TrpcOrganizationRole = string;

/**
 * `permissionChecked` is what `enforcePermissionCheck` reads: a procedure
 * that reaches its resolver without it was never checked. `organizationRole`
 * is the legacy carry-forward project/team resolutions leave downstream.
 */
export interface TrpcDeclaredAuthzContext {
  permissionChecked: boolean;
  organizationRole?: TrpcOrganizationRole | null;
}

/**
 * `any` here is load-bearing: tRPC's `.use()` requires a middleware whose
 * return is assignable to its own `MiddlewareResult`, and a declared check
 * is written against the scope input rather than one procedure's generics.
 */
type DeclaredCheckNext = () => any;

export type TrpcDeclaredCheckParams<TContext> = {
  ctx: TrpcMiddlewareContext<TContext>;
  input: ScopeInput;
  next: DeclaredCheckNext;
};

/**
 * What a check reading only the request context is handed. `authorizeInService`
 * reads no id at all, so this omits the `input` field the other checks require.
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
 * Deliberately not parameterised on the request context: what the chain
 * needs back is an installed check, and naming the context here would make
 * every process's own middleware shape part of the contract.
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

export type TrpcDeclaredAuthzMembers<TContext> = Readonly<{
  identity: TrpcActorReader<TContext>;
  authorization: TrpcAuthorization<TContext>;
  denials: TrpcAuthorizationDenial;
}>;

/**
 * Writes through the narrow context this package owns, not the process's own
 * type parameter: a write to a generic's property is not expressible, and
 * widening it would let a caller pass a context never meant to be mutated.
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

async function authorizePermission<TContext extends TrpcDeclaredAuthzContext>({
  ports,
  ctx,
  input,
  required,
  via,
}: {
  ports: TrpcDeclaredAuthzMembers<TContext>;
  ctx: TrpcDeclaredCheckParams<TContext>["ctx"];
  input: TrpcDeclaredCheckParams<TContext>["input"];
  required: AuthzPermission;
  via: ScopeTierField | undefined;
}): Promise<void> {
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
}

async function authorizeAnyPermission<TContext extends TrpcDeclaredAuthzContext>({
  ports,
  ctx,
  input,
  permissions,
}: {
  ports: TrpcDeclaredAuthzMembers<TContext>;
  ctx: TrpcDeclaredCheckParams<TContext>["ctx"];
  input: TrpcDeclaredCheckParams<TContext>["input"];
  permissions: readonly [AuthzPermission, ...AuthzPermission[]];
}): Promise<void> {
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
}

function refuseUnallowedScopeFields<TContext extends TrpcDeclaredAuthzContext>({
  ctx,
  input,
  allow,
}: {
  ctx: TrpcDeclaredCheckParams<TContext>["ctx"];
  input: TrpcDeclaredCheckParams<TContext>["input"];
  allow: Record<string, string> | undefined;
}): void {
  const allowedKeys = Object.keys(allow ?? {});
  // `input` is typed as ScopeInput, but a procedure with no `.input()` hands
  // tRPC's actual runtime value through as `undefined`. Without this guard,
  // `key in input` throws and every such procedure 500s instead of running
  // the (vacuous, but valid) no-permission check.
  const safeInput: object = typeof input === "object" && input !== null ? input : {};

  for (const key of SENSITIVE_SCOPE_FIELDS) {
    if (key in safeInput && !allowedKeys.includes(key)) {
      throw new Error(`${key} is not allowed to be used without permission check`);
    }
  }

  markPermissionChecked(ctx);
}

export function createDeclaredAuthzMiddlewares<TContext extends TrpcDeclaredAuthzContext>(
  ports: TrpcDeclaredAuthzMembers<TContext>,
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
        await authorizePermission({ ports, ctx, input, required, via });

        return next();
      },
    );

  /**
   * `.permissionAny(…)` — any one of the permissions is enough. The denial
   * names the FIRST permission, so callers list the primary surface first.
   */
  const permissionAny = (
    permissions: readonly [AuthzPermission, ...AuthzPermission[]],
  ): TrpcDeclaredCheck<TContext> =>
    declareAuthzMiddleware(
      { kind: "permission-any", permissions },
      async ({ ctx, input, next }: TrpcDeclaredCheckParams<TContext>) => {
        await authorizeAnyPermission({ ports, ctx, input, permissions });

        return next();
      },
    );

  /**
   * `.noPermission({ reason, allow })` — authenticated, deliberately unchecked.
   * This runtime guard is the defense in depth behind the type layer's own
   * refusal of unallowed scoped input fields.
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
        refuseUnallowedScopeFields({ ctx, input, allow });

        return next();
      },
    );

  /**
   * `.authorizeInService(...)` — the scope is data the handler loads at runtime,
   * so the SERVICE performs the real authorization; `enforces` names what in
   * the resolver covers each scope field for the sweep.
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
 * The caller named the scope field and left it empty — answered as a bad
 * request, not the wiring bug below: it's the caller's typo to fix, not an
 * internal error that misleads them and pages us for it.
 */
function blankScopeId({ field }: { field: string }): TRPCError {
  const blank = new BlankScopeIdError({ field });

  return new TRPCError({
    code: "BAD_REQUEST",
    message: blank.message,
    cause: blank,
  });
}

/** Input carries no scope field; types make unreachable (runtime backstop); see
 * `blankScopeId` for empty field case */
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
 * The one denial shape for every tier: an id that resolves to nothing
 * answers exactly like one the caller may not touch, so no probe can learn
 * whether a scope EXISTS.
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

/** Middleware parameters annotated to avoid type cascade from tRPC's context mapping */
type ScopeLineageParams<TContext> = {
  ctx: TrpcMiddlewareContext<TContext>;
  input: unknown;
  next: () => any;
};

/** Not `TRPCMiddlewareFunction` to avoid re-imposing mapped context; `any` result is
 * intentional */
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

// The permission procedure builder: declaration made mandatory by construction; .query
// / .mutation / .subscription unavailable until declared

type OverwriteIfDefined<TType, TWith> = UnsetMarker extends TType ? TWith : Simplify<TType & TWith>;

/** Parameter shape for hand-written checks; `any` on `next` and return is load-bearing */
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
 * Typescript hackery to force endpoints to set the input, declare a check middleware, and
 * ensure compatibility with inputs required
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
   * The custom-check escape hatch — only middleware branded by
   * `declareAuthzMiddleware(...)` is accepted, so an undeclared function that
   * flips `ctx.permissionChecked` is a compile error here, not a CI finding.
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
   * ADR-092 decision 25: declare the required permission, typed against the
   * input; a missing or wrong-tier scope id is a compile error naming it.
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
   * The derivation form, for a permission whose tier the input omits: `via`
   * must name a field whose tier can derive one the permission is grantable
   * at — written at the call site, never inferred.
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
   * Any one of the permissions is enough. List the primary surface's
   * permission first — the denial names it, so granting it resolves the
   * refusal whichever feature the caller came through.
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
   * Authenticated, deliberately unchecked. Every scope id the input carries
   * must be individually allowed with a written reason: the legacy
   * `skipPermissionCheck` runtime guard, moved to compile time.
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
   * The scope is data the handler loads at runtime, so the SERVICE performs
   * the real authorization — this only moves WHERE the check happens, never
   * whether one does.
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

/** Installing a check requires the declaration brand; only `declareAuthzMiddleware` produces it */
type InstallableCheck = DeclaredAuthzMiddleware<(params: never) => Promise<unknown>>;

/**
 * `TCheckContext` is the request context a hand-written custom check
 * receives through `.use()` — the process's, named once here, so this
 * package never has to know what else rides on that context.
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
     * The one chain every entry point builds. Order is behaviour: the check
     * must sit inside the error/tracing middlewares and before `enforceCheck`,
     * which proves a check ran at all.
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
        .use(middlewares.scopeLineageGuard(findAuthzDeclaration(check)))
        .use(check)
        .use(middlewares.enforceCheck)
        .use(middlewares.auditMutations) as unknown as Declared;

    const builder = {
      input(input: Parser) {
        // tRPC types `.input()` as a conditional on the input already accumulated,
        // which never resolves for a forwarding procedure and lands on the
        // framework's `TypeError<…>` branch. The cast is on the FORWARDING seam
        // only — the parser reaching tRPC is the caller's own.
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

/** Procedures are callables with `_def`, not plain objects; unreadable throws rather than
 * returns empty (empty list must mean no auth, not unknown shape) */
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
 * Whether a built procedure skips authentication — built from the public
 * procedure and callable without a session. Backs the public-surface
 * allowlist test, the tripwire for a deliberate unauthenticated endpoint.
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

// The process middlewares every tRPC procedure is wrapped in; ORDER IS BEHAVIOUR: tracer,
// logger, handled-error, scope-lineage guard, check, enforceCheck, audit (reads validated input)

/** Everything the process supplies for the policy below to exist. */
export type TrpcRuntimePolicyMembers<TContext, TAuthenticatedContext extends object> = Readonly<{
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

/** Record failed call on span; span status UNSET for customer faults (404 is not an error) */
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
 * Called once per root. Every middleware it returns belongs to that root,
 * so a process composes exactly one of these and hands the pieces to its
 * mounts.
 */
/**
 * The TRPCError a known cause becomes: a HandledError keeps its code, a bare
 * ZodError is promoted as the REST door does, and a process-translated cause
 * takes its translation. None for anything else.
 */
function promotedTrpcErrors({
  cause,
  translate,
}: {
  cause: unknown;
  translate: (cause: unknown) => { code: TRPCError["code"]; message: string } | null | undefined;
}): TRPCError[] {
  if (HandledError.isHandled(cause)) {
    return [
      new TRPCError({
        code: handledErrorToTRPCCode(cause),
        message: cause.message,
        cause,
      }),
    ];
  }

  if (isZodLikeError(cause)) {
    // `ValidationError.fromZodError` is the same promotion the error
    // formatter performs, so the serialised payload on the wire is byte for
    // byte what it already was — only `data.code` and the HTTP status change.
    const validation = ValidationError.fromZodError(cause);

    return [
      new TRPCError({
        code: handledErrorToTRPCCode(validation),
        // The code, not `validation.message`: zod's `message` is the whole
        // issue array as JSON, and this string is what the span and the log
        // record carry. The wire message is the code either way (#5984).
        message: validation.code,
        cause: validation,
      }),
    ];
  }

  const translated = translate(cause);

  if (translated) {
    return [
      new TRPCError({
        code: translated.code,
        message: translated.message,
        cause,
      }),
    ];
  }
  return [];
}

/** The real admin behind an impersonated action, for security forensics. */
function impersonationMetadata(actor: {
  impersonatorId?: string | null;
}): { impersonatorId: string } | undefined {
  return actor.impersonatorId ? { impersonatorId: actor.impersonatorId } : undefined;
}

/**
 * One traced call. In tRPC v10, next() never throws: downstream errors are
 * returned as { ok: false, error } result objects, not thrown.
 */
async function traceCall<TResult extends MiddlewareResult<object>>({
  span,
  next,
  asError,
}: {
  span: Span;
  next: () => Promise<TResult>;
  asError: (failure: unknown) => Error;
}): Promise<TResult> {
  const result = await next();
  if (!result.ok) {
    trpcFailureTraceIds.remember(result.error, span);
    recordSpanError(span, result.error, asError);
  }
  span.end();
  return result;
}

/** A silenced route traces nothing on success, and still records a span for a failure. */
async function traceSilencedFailure<TResult extends MiddlewareResult<object>>({
  tracer,
  spanName,
  path,
  type,
  parentContext,
  next,
  asError,
}: {
  tracer: ReturnType<typeof otelTrace.getTracer>;
  spanName: string;
  path: string;
  type: ProcedureType;
  parentContext: ReturnType<typeof callerTraceContext>;
  next: () => Promise<TResult>;
  asError: (failure: unknown) => Error;
}): Promise<TResult> {
  const startTime = nowInstant().epochMilliseconds;
  const result = await next();
  if (result.ok) return result;

  const span = tracer.startSpan(
    spanName,
    { kind: SpanKind.SERVER, startTime, attributes: spanAttributes(path, type) },
    parentContext,
  );

  trpcFailureTraceIds.remember(result.error, span);
  recordSpanError(span, result.error, asError);
  span.end();

  return result;
}

/** What a finished mutation audits: the target it touched, or the error it failed with. */
function mutationOutcome({ path, result }: { path: string; result: MiddlewareResult<object> }): {
  target: ReturnType<typeof deriveAuditTarget> | Record<string, never>;
  error: TRPCError | undefined;
} {
  if (result.ok) return { target: deriveAuditTarget(path, result.data), error: undefined };
  return { target: {}, error: result.error };
}

/** The user agent and status code a tRPC call log line carries, when the transport has them. */
function callerDetails(ctx: {
  req?: { headers: { "user-agent"?: string } } | null;
  res?: { statusCode?: number } | null;
}): { userAgent: string | null; statusCode: number | null } {
  return {
    userAgent: ctx.req?.headers["user-agent"] ?? null,
    statusCode: ctx.res?.statusCode ?? null,
  };
}

/** A failed, non-mutation call by a signed-in actor that tRPC reports as a known error. */
function failuresToAudit<TActor extends { id?: string }>({
  type,
  permissionChecked,
  result,
  actor,
}: {
  type: ProcedureType;
  permissionChecked: boolean | undefined;
  result: MiddlewareResult<object>;
  actor: TActor | null | undefined;
}): { error: TRPCError; actor: TActor & { id: string } }[] {
  const auditedAsMutation = type === "mutation" && permissionChecked; // avoid duplicated logs
  if (auditedAsMutation || result.ok || !actor?.id) return [];
  const { error } = result;
  if (!(error instanceof TRPCError) || error.code === "INTERNAL_SERVER_ERROR") return [];
  return [{ error, actor: { ...actor, id: actor.id } }];
}

export function createTrpcRuntimePolicy<
  TContext extends TrpcPolicyContext & object,
  TAuthenticatedContext extends object,
>(root: TrpcRoot<TContext>, ports: TrpcRuntimePolicyMembers<TContext, TAuthenticatedContext>) {
  /** Plain functions preserve identity/order for comparison; type-checking against
   * `MiddlewareFunction` rather than `MiddlewareBuilder` */
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

    const [failure] = failuresToAudit({
      type,
      permissionChecked: ctx.permissionChecked,
      result,
      actor,
    });
    if (!failure) return result;
    const auditedInput = input ?? (await getRawInput());
    const scopeIds = auditScopeIds(auditedInput);

    await ports.audit.record({
      userId: failure.actor.id,
      organizationId: scopeIds.organizationId,
      projectId: scopeIds.projectId,
      action: path,
      // Through the same redaction as the success path. This middleware sits
      // ahead of the input parser, so tRPC hands it no parsed `input`;
      // reading the raw input is what puts the arguments, project and
      // organization on a failed call's row instead of leaving them blank.
      args: redactAuditArgs({ input: auditedInput, action: path }),
      error: failure.error,
      req: ctx.req,
      // When an admin is impersonating, the actor id reflects the
      // impersonated user (correct for RBAC attribution). We stamp the
      // real admin's identity in metadata so security forensics can
      // filter on `metadata.impersonatorId`.
      metadata: impersonationMetadata(failure.actor),
    });

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

      const { target, error } = mutationOutcome({ path, result });
      const scopeIds = auditScopeIds(auditedInput);

      await ports.audit.record({
        userId: actor.id,
        organizationId: scopeIds.organizationId,
        projectId: scopeIds.projectId,
        action: path,
        args: redactAuditArgs({ input: auditedInput, action: path }),
        error,
        req: ctx.req,
        targetKind: target.targetKind,
        targetId: target.targetId,
        // Stamp the real admin id when the action is happening during
        // impersonation. `userId` above is the impersonated target (the
        // RBAC actor); metadata.impersonatorId is the human performing it.
        metadata: impersonationMetadata(actor),
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
      return traceSilencedFailure({ tracer, spanName, path, type, parentContext, next, asError });
    }

    return otelContext.with(parentContext, () =>
      tracer.startActiveSpan(
        spanName,
        { kind: SpanKind.SERVER, attributes: spanAttributes(path, type) },
        (span) => traceCall({ span, next, asError }),
      ),
    );
  });

  /** Converts HandledErrors to TRPCErrors (else fall through as INTERNAL_SERVER_ERROR);
   * promotes bare ZodErrors same as REST door does */
  const handledErrorMiddleware = root.middleware(async ({ next }) => {
    const result = await next();
    if (result.ok) return result;

    const [promoted] = promotedTrpcErrors({
      cause: result.error.cause,
      translate: (cause) => ports.causes.translate(cause),
    });
    if (promoted) throw promoted;

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
        ...callerDetails(ctx),
        log: trpcLogger,
        capture: (failure: unknown) => ports.errorReporting.capture(failure),
      });

      return result;
    });
  });

  /** Protected (authenticated) procedure; verifies session and guarantees authenticated context */
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
