/**
 * Everything the tRPC policy spine needs from the process it runs in.
 *
 * The spine owns tracing, request logging, handled-error translation, the
 * scope-lineage guard, the declared authorization check, the fail-closed
 * backstop and the audit trail. It owns none of the concrete things those
 * need — who the caller is, which service decides authorization, where an
 * audit row is written, which reporter an unhandled 5xx goes to, or which
 * application error classes become a bad request. Each of those arrives as a
 * port the process fills, so this package holds no application import, no
 * Prisma, and no service locator.
 */
import type {
  AuthzGetDecisionInput,
  AuthzGetProjectAnyDecisionInput,
  AuthzScopeLineageInput,
  AuthzScopeLineageResult,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { TRPCError } from "@trpc/server";
import type { Overwrite, Simplify } from "@trpc/server/unstable-core-do-not-import";

/**
 * The request context as tRPC actually hands it to a middleware.
 *
 * tRPC never gives a middleware the bare context type: it gives that type with
 * its index signatures stripped (`Overwrite<TContext, object>`, flattened by
 * `Simplify`). At runtime the two are the same object, but for a `TContext`
 * that is still a type parameter the compiler cannot prove the mapped form
 * assignable back to it, so a port declared `(ctx: TContext)` cannot be called
 * with what the middleware was given.
 *
 * Every port below is therefore declared against what it is actually handed.
 * A process fills these ports with a concrete context, where the mapping
 * reduces away and its implementations read exactly the fields they always
 * did.
 */
export type TrpcMiddlewareContext<TContext> = Simplify<Overwrite<TContext, object>>;

/**
 * The same context, as a middleware installed AFTER the authenticating one
 * receives it: `TContext` with the authenticated shape written over it.
 *
 * The audit middleware sits behind the authentication middleware and still
 * reads the caller, so `actor` is handed this rather than the plain context.
 * Runtime-identical again — the object is the one the process built, with a
 * narrowed session on it — but the compiler treats the two mappings as
 * unrelated, so the port has to name both.
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
 * own session shape: the procedures downstream read the narrowed session the
 * process returns here, not a shape this package invented.
 */
export interface TrpcIdentityPort<
  TContext,
  TAuthenticatedContext extends object,
> extends TrpcActorPort<TContext> {
  authenticate(ctx: TrpcMiddlewareContext<TContext>): TAuthenticatedContext;
  /**
   * Widened from `TrpcActorPort`: the audit middleware reads the caller from
   * behind the authentication middleware, where the context carries the
   * authenticated shape. Both spellings are the same object, and the fields
   * `actor` reads are the ones `TContext` already had.
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
export interface TrpcAuditPort {
  record(entry: TrpcAuditEntry): Promise<void>;
}

/**
 * Where an unhandled server fault is reported, and how an unknown failure
 * becomes an Error.
 *
 * Both belong to the process: it owns the reporter, and it already owns the
 * one coercion rule the rest of the application uses. Asking for it here
 * keeps a second copy of that rule out of this package.
 */
export interface TrpcErrorReportingPort {
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
export interface TrpcCauseTranslationPort {
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
export interface TrpcAuthorizationPort<TContext> {
  forRequest(ctx: TrpcMiddlewareContext<TContext>): TrpcAuthorizationDecisions;
}

/**
 * The two refusals whose concrete error class is the process's to choose.
 *
 * The denial SHAPE is this package's — which condition is answered first, and
 * that both answer UNAUTHORIZED with the domain error as the cause — but the
 * classes themselves carry product copy and codes a client renders, so they
 * are supplied rather than imported.
 */
export interface TrpcAuthorizationDenialPort {
  /** The membership exists but an admin disabled it, so it grants nothing. */
  membershipDisabled(): Error;
  /** The organization role does not reach this feature at all. */
  liteMemberRestricted(resource: string): Error;
}
