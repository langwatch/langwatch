/**
 * The app process's declaring procedure builders, composed.
 *
 * The builder itself is `@langwatch/api/trpc`'s: after `.input()` it exposes only
 * the declaring methods and no `.query` / `.mutation`, so an undeclared
 * procedure does not compile. What is decided here is which concrete
 * middlewares the chain installs and which request context a hand-written
 * custom check receives.
 */
import {
  createIsPublicProcedure,
  createPermissionProcedureBuilder,
  type TrpcPolicyChainMiddlewares,
} from "@langwatch/api/trpc";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
  type DeclaredAuthzRequestContext,
} from "../app-layer/authz/trpc-middleware";
import type { PermissionMiddlewareParams } from "./rbac";
import { appTrpcRoot } from "./trpc.root";
import { scopeLineageGuard } from "./trpc.scope-lineage-middleware";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  enforceUserIsAuthed,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "./trpc.runtime-policy";

/**
 * The request context a hand-written custom check receives through `.use()`.
 * The legacy `.use()`d middlewares are typed against it, so it is named here
 * rather than invented, and `.use()` keeps refusing a check whose input does
 * not match the procedure's.
 */
type AppCheckContext = PermissionMiddlewareParams<unknown>["ctx"];

const policyMiddlewares: TrpcPolicyChainMiddlewares = {
  tracer: tracerMiddleware,
  logger: loggerMiddleware,
  handledError: handledErrorMiddleware,
  scopeLineageGuard,
  enforceCheck: enforcePermissionCheck,
  auditMutations: auditLogMutations,
};

const permissionProcedureBuilder = createPermissionProcedureBuilder<
  AppCheckContext,
  DeclaredAuthzRequestContext
>(policyMiddlewares, {
  permission: checkDeclaredPermission,
  permissionAny: checkDeclaredPermissionAny,
  noPermission: declaredNoPermission,
  serviceAuthorized: declaredServiceAuthorization,
});

export const protectedProcedure = permissionProcedureBuilder(authProtectedProcedure);

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 *
 */
export const publicProcedure = permissionProcedureBuilder(appTrpcRoot.procedure);

/**
 * Whether a built procedure skips `enforceUserIsAuthed` — i.e. was built from
 * `publicProcedure` and is callable without a session. Backs the
 * public-surface allowlist test, the tripwire that makes adding a new
 * unauthenticated endpoint a deliberate, reviewed act.
 */
export const isPublicProcedure = createIsPublicProcedure(enforceUserIsAuthed);
