import { AuthenticatedActorRequiredError } from "@langwatch/api";
import {
  createRestService,
  createService,
  type MountedRoute,
  type RequestActor,
  type StaticRestVersioning,
} from "@langwatch/api/rest";
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
import {
  credentialClassFor,
  familyFromBasePath,
  publicEndpoint,
  registerRoutePolicy,
  requires,
} from "@langwatch/platform-api/app-rest";
import type { App } from "~/server/app-layer/app";

/**
 * Project-scoped public API composition for @langwatch/api services.
 *
 * Authentication, permission enforcement and route-policy registration are
 * derived from the endpoint's single `withPermission(...)` declaration. A
 * feature installer only supplies its REST operations and schemas.
 */
export function createProjectApiService(options: { name: string; basePath: string }) {
  const family = familyFromBasePath(options.basePath);
  return createService<Project, App>({
    name: options.name,
    basePath: options.basePath,
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
 * policy seams with the canonical project API. A feature only declares its
 * REST schemas and maps a validated request to its composed service.
 *
 * `application` is what a door is handed as `context.app`. A REST family serves
 * exactly one feature, and its handlers call that feature's application
 * directly, so the family names it here and the process App stays the thing it
 * is selected from. Without this the whole `App` reached every handler and a
 * door's own operations were looked up on an object that has none of them.
 */
export function createProjectRestApiService<TApplication>(options: {
  name: string;
  basePath?: string;
  application: (app: App) => TApplication;
  staticVersioning?: StaticRestVersioning;
  maxInputBytes: number;
  rateLimitOptOut: string;
  resourceLimitOptOut: string;
}) {
  const basePath = options.basePath ?? `/api/v1/${options.name}`;
  const family = familyFromBasePath(basePath);
  const application = options.application;
  return createRestService<TApplication>({
    name: options.name,
    basePath,
    staticVersioning: options.staticVersioning,
    maxInputBytes: options.maxInputBytes,
    middleware: [appContextMiddleware],
    app: (context) => application(appFromContext(context)),
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
  if (route.isNamespaceGuard) {
    policy = publicEndpoint("version namespace guard serves only a 404");
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
