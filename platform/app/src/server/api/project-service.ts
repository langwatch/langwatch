import {
  AuthenticatedActorRequiredError,
  createRestService,
  createService,
  type MountedRoute,
  type RequestActor,
  type StaticRestVersioning,
} from "@langwatch/api";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { Context } from "hono";
import type { Project } from "~/generated/prisma/client";
import { appContextMiddleware, appFromContext } from "~/app/api/middleware/app-context";
import {
  canonicalAuthMiddleware,
  modernRestAuthMiddleware,
  requirePermission,
  requirePermissionOrThrow,
} from "~/app/api/middleware/auth";
import { enforceApiKeyCeiling } from "~/server/api-key/auth-middleware";
import type { ResolvedApiKeyToken as ResolvedToken } from "@langwatch/api-key-contract";
import { credentialClassFor, familyFromBasePath, publicEndpoint, registerRoutePolicy, requires } from "@langwatch/platform-api/app-rest";
import type { App } from "~/server/app-layer/app";

/**
 * Project-scoped public API composition for @langwatch/api services.
 *
 * Authentication, permission enforcement and route-policy registration are
 * derived from the endpoint's single `withPermission(...)` declaration. A
 * feature installer only supplies its RPC/REST operations and schemas.
 */
export function createProjectApiService(options: {
  name: string;
  basePath: string;
  openapiUrl?: string;
}) {
  const family = familyFromBasePath(options.basePath);
  return createService<Project, App>({
    name: options.name,
    basePath: options.basePath,
    openapiUrl: options.openapiUrl,
    middleware: [appContextMiddleware],
    app: appFromContext,
    actor: resolveRequestActor,
    authorize: authorizeRequestPermission,
    projectIdInput: true,
    auth: canonicalAuthMiddleware,
    permissionEnforcer: (permission: AuthzPermission) => requirePermission(permission, "canonical"),
    onRouteMounted: (route) => registerProjectApiRoute({ route, family }),
  });
}

/**
 * Project-scoped composition for the validated public REST surface.
 *
 * It deliberately shares the auth, input-target, API-key ceiling and route
 * policy seams with RPC. A feature only declares its REST schemas and maps a
 * validated request to its composed service.
 */
export function createProjectRestApiService(options: {
  name: string;
  basePath?: string;
  staticVersioning?: StaticRestVersioning;
  maxInputBytes: number;
  openapiUrl?: string;
  rateLimitOptOut: string;
  resourceLimitOptOut: string;
}) {
  const basePath = options.basePath ?? `/api/v1/${options.name}`;
  const family = familyFromBasePath(basePath);
  return createRestService<App>({
    name: options.name,
    basePath,
    staticVersioning: options.staticVersioning,
    maxInputBytes: options.maxInputBytes,
    openapiUrl: options.openapiUrl,
    middleware: [appContextMiddleware],
    app: appFromContext,
    actor: resolveRequestActor,
    authorize: authorizeRequestPermission,
    projectIdInput: true,
    auth: modernRestAuthMiddleware,
    permissionEnforcer: requirePermissionOrThrow,
    onRouteMounted: (route) => registerProjectApiRoute({ route, family }),
    openapiSecurity: [{ project_api_key: [] }],
  })
    .withoutRateLimit(options.rateLimitOptOut)
    .withoutResourceLimit(options.resourceLimitOptOut);
}

async function authorizeRequestPermission(
  context: Context,
  permission: AuthzPermission,
): Promise<void> {
  const resolved = context.get("resolvedToken") as ResolvedToken | undefined;
  if (!resolved) {
    throw new Error("Project authentication did not provide a resolved credential");
  }
  await enforceApiKeyCeiling({
    resolved,
    permission,
    app: appFromContext(context),
  });
}

function resolveRequestActor(context: Context): RequestActor {
  const apiKeyUserId: unknown = context.get("apiKeyUserId");
  if (typeof apiKeyUserId === "string" && apiKeyUserId.length > 0) {
    return { id: apiKeyUserId };
  }
  throw new AuthenticatedActorRequiredError();
}

function registerProjectApiRoute({ route, family }: { route: MountedRoute; family: string }): void {
  let policy = null;
  if (route.isNamespaceGuard || route.isDiscoverEndpoint) {
    policy = publicEndpoint(
      route.isDiscoverEndpoint
        ? "RPC discovery publishes schemas and no tenant data"
        : "version namespace guard serves only a 404",
    );
  } else if (route.config?.permission) {
    policy = requires(route.config.permission);
  }
  if (!policy) {
    throw new Error(
      `Project API endpoint ${route.method.toUpperCase()} ${route.path} declares no permission`,
    );
  }
  registerRoutePolicy({
    method: route.method,
    path: route.path,
    policy,
    family,
    credentialClass: credentialClassFor({ scope: "project", policy }),
  });
}
