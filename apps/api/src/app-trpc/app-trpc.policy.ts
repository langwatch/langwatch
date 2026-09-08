/**
 * The API process's own tRPC policy chain, built on its own root.
 *
 * Until now this process mounted two feature routers on a bare
 * `root.procedure` wrapped in one hand-written span-and-audit middleware. That
 * is enough for a surface whose every procedure authorizes inside its own
 * handler, and not enough for the packaged surfaces: those declare their access
 * as an `AuthzDeclaration` and are mounted through `AppTrpcPolicyMiddlewares`,
 * which the process — not the feature — has to supply.
 *
 * Everything the chain is made of is already packaged in `@langwatch/api/trpc`.
 * What was missing was a process that filled the ports: an identity port over
 * this process's request context, an authorization port over the AuthZ service
 * it already composes, an audit port over the sink it already holds, and the
 * error-reporting and cause-translation ports. That is all this module is.
 *
 * ORDER IS BEHAVIOUR — see `declaredPolicy` in `@langwatch/api/trpc`. Nothing
 * here re-states the order; it hands the pieces over and the packaged
 * composition puts them in it.
 */
import type { Actor } from "@langwatch/actor";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  createDeclaredAuthzMiddlewares,
  createScopeLineageGuard,
  createTrpcRuntime,
  createTrpcRuntimePolicy,
  isAuditLogExempt,
  redactAuditArgs,
  type AppTrpcPolicyMiddlewares,
  type TrpcAuditPort,
  type TrpcAuthorizationDecisions,
  type TrpcAuthorizationDenialPort,
  type TrpcAuthorizationPort,
  type TrpcCauseTranslationPort,
  type TrpcErrorReportingPort,
  type TrpcDeclaredAuthzContext,
  type TrpcIdentityPort,
  type TrpcPolicyContext,
  type TrpcRoot,
  type TrpcRuntimeContext,
  type TrpcRuntimePorts,
} from "@langwatch/api/trpc";
import { declaredCheckFrom } from "./app-trpc.declared-check.ts";

/**
 * What the process fills for the chain to exist.
 *
 * `authz` is the decisions half of the composed AuthZ service — the same
 * instance the REST doors authorize through, never a second one, because two
 * services for one organization is two permission caches and two epochs.
 */
export type ApiTrpcPolicyPorts<TContext, TAuthenticatedContext extends object> = Readonly<{
  authz: TrpcAuthorizationDecisions;
  identity: TrpcIdentityPort<TContext, TAuthenticatedContext>;
  audit: TrpcAuditPort;
  errorReporting: TrpcErrorReportingPort;
  causes: TrpcCauseTranslationPort;
  denials: TrpcAuthorizationDenialPort;
}>;

/**
 * Builds this process's policy chain and its authenticated procedure.
 *
 * Called ONCE per root: every middleware belongs to the root that produced it,
 * so a second call would hand out middlewares from a root nothing is mounted
 * on.
 *
 * The authorization port answers the SAME decisions object for every request.
 * The packaged port is a resolver because a process may compose its decisions
 * per request; this one does not — the AuthZ service is process-wide and reads
 * the caller from the arguments it is given, never from ambient state.
 */
export function createApiTrpcPolicy<
  TContext extends TrpcPolicyContext & TrpcDeclaredAuthzContext & TrpcRuntimeContext & object,
  TAuthenticatedContext extends object,
>(root: TrpcRoot<TContext>, ports: ApiTrpcPolicyPorts<TContext, TAuthenticatedContext>) {
  const runtime = createTrpcRuntimePolicy<TContext, TAuthenticatedContext>(root, {
    identity: ports.identity,
    audit: ports.audit,
    errorReporting: ports.errorReporting,
    causes: ports.causes,
  });

  const authorization: TrpcAuthorizationPort<TContext> = {
    forRequest: () => ports.authz,
  };

  const declared = createDeclaredAuthzMiddlewares<TContext>({
    identity: ports.identity,
    authorization,
    denials: ports.denials,
  });

  const scopeLineage = createScopeLineageGuard<TContext>({ authorization });

  const middlewares: AppTrpcPolicyMiddlewares = {
    tracer: runtime.tracerMiddleware,
    logger: runtime.loggerMiddleware,
    handledError: runtime.handledErrorMiddleware,
    scopeLineageGuard: (declaration) => scopeLineage(declaration),
    declaredCheck: declaredCheckFrom({
      permission: (input) => declared.permission(input),
      // Widened at this seam rather than in the declaration: a
      // `permission-any` declaration is parsed from a non-empty tuple, and the
      // builder states that non-emptiness while the process-facing builder
      // interface states only "some permissions". Refusing an empty list here
      // is what keeps the two honest.
      permissionAny: (permissions) => declared.permissionAny(asNonEmpty(permissions)),
      noPermission: (input) => declared.noPermission(input),
      serviceAuthorized: (input) => declared.serviceAuthorized(input),
    }),
    enforceCheck: runtime.enforcePermissionCheck,
    auditMutations: runtime.auditLogMutations,
  };

  return {
    protectedProcedure: runtime.authProtectedProcedure,
    middlewares,
    // The declared path, on the same collaborators. Built here rather than
    // beside the mounts so a second root can never hand out its middlewares.
    declaredRuntime: createTrpcRuntime<TContext>({
      root: root as Parameters<typeof createTrpcRuntime<TContext>>[0]["root"],
      procedure: runtime.authProtectedProcedure,
      ports: runtimePorts(ports),
    }),
  };
}

/** The same ports the policy chain runs on, as the declared path names them. */
function runtimePorts<TContext extends TrpcRuntimeContext & object, TAuthenticated extends object>(
  ports: ApiTrpcPolicyPorts<TContext, TAuthenticated>,
): TrpcRuntimePorts<TContext> {
  // tRPC hands a middleware the context with its index signatures stripped,
  // which the compiler cannot prove assignable back to an unresolved
  // `TContext`. The port reads exactly the fields `TContext` already had.
  const actorOfContext = ports.identity.actor as (
    ctx: TContext,
  ) => { id: string; impersonatorId?: string } | undefined;

  return {
    identity: { caller: (ctx) => ({ actor: actorOf(actorOfContext(ctx)) }) },
    authorization: { forRequest: () => ports.authz },
    denials: ports.denials,
    audit: {
      record: (entry) => ports.audit.record(entry),
      redact: ({ procedure, args }) => redactAuditArgs({ input: args, action: procedure }),
      exempt: (procedure) => isAuditLogExempt(procedure),
    },
    errors: {
      report: (failure) => ports.errorReporting.capture(failure),
      asError: (failure) => ports.errorReporting.asError(failure),
      translate: (cause) => ports.causes.translate(cause),
    },
  };
}

/**
 * The one identity the path attributes a call to. `id` stays the impersonated
 * user, because that is who the authorization decision is about; the real
 * administrator behind them travels beside it for the audit row.
 */
function actorOf(
  actor: { id: string; impersonatorId?: string } | undefined,
): (Actor & { id: string }) | null {
  if (!actor) return null;

  return {
    type: "user",
    id: actor.id,
    ...(actor.impersonatorId ? { impersonatorId: actor.impersonatorId } : {}),
  };
}

/**
 * A `permission-any` declaration with no permissions would install a check
 * that can never pass and would read, in the declaration sweep, as a covered
 * procedure. Refusing it at composition is the only reading that is safe.
 */
function asNonEmpty(
  permissions: readonly AuthzPermission[],
): readonly [AuthzPermission, ...AuthzPermission[]] {
  const [first, ...rest] = permissions;
  if (!first) {
    throw new Error("a permission-any authorization declaration named no permissions");
  }
  return [first, ...rest];
}
