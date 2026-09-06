/**
 * Factory for project-key API families on `@langwatch/api`.
 *
 * The management factory's counterpart for the `/api/v1` surface: same
 * one-declaration-per-endpoint contract, same policy-registering mount
 * callback, a project API key instead of an organization one, and no
 * Enterprise plan gate — these families ship with the product.
 *
 * `guard(permission)` returns both halves from the same permission: the policy
 * the route-policy registry records, and the `permission` the framework mounts
 * its enforcer from. `registerMountedRoute` then classifies every mount the
 * framework creates, the two version-namespace guards included.
 */
import { createService } from "@langwatch/api";
import type { AuthzPermission } from "@langwatch/authz";
import type { MiddlewareHandler } from "hono";
import { appContextMiddleware } from "~/app/api/middleware/app-context";
import {
  canonicalAuthMiddleware,
  requirePermission,
} from "~/app/api/middleware/auth";
import type { Project } from "~/generated/prisma/client";
import {
  registerMountedRoute,
  type ServiceEndpointMeta,
} from "~/server/api/route-mount-registry";
import { familyFromBasePath, requires } from "~/server/api/security";

/** @see ServiceEndpointMeta, which this family's `guard(...)` produces. */
export type ProjectEndpointMeta = ServiceEndpointMeta;

/**
 * A versioned project service. Use the returned `guard(permission)` on EVERY
 * endpoint:
 *
 * ```ts
 * const { service, guard } = createProjectService({
 *   name: "run-plans",
 *   basePath: "/api/v1/run-plans",
 * });
 *
 * service.version(V1_API_VERSION, (v) => {
 *   v.get("/", { ...guard("scenarios:view"), output, description, docs }, handler);
 * });
 * ```
 *
 * The enforcement order is project-key authentication first, then the RBAC
 * check: "we do not know who you are" must beat "you may not do this", and the
 * permission check reads the credential authentication resolved.
 *
 * Both refuse in the canonical error envelope, because these families publish
 * it rather than the flat shape the families that predate it answer with.
 */
export function createProjectService({
  name,
  basePath,
  middleware = [],
}: {
  name: string;
  /** Spelled out at the call site so the route-coverage gate can read it. */
  basePath: string;
  /**
   * Middleware every request of the family runs after the app context is set,
   * for example the deprecation headers of an alias family.
   */
  middleware?: MiddlewareHandler[];
}) {
  const family = familyFromBasePath(basePath);

  const service = createService<Project>({
    name,
    basePath,
    middleware: [appContextMiddleware, ...middleware],
    auth: canonicalAuthMiddleware,
    // The framework mounts this for every endpoint that declares a
    // `permission`, between auth and the endpoint's own middleware, so an
    // endpoint's `middleware` array can never displace the check its declared
    // policy promises.
    permissionEnforcer: (permission) =>
      requirePermission(permission, "canonical"),
    onRouteMounted: (route) =>
      registerMountedRoute({
        route,
        family,
        scope: "project",
        surface: "Project",
      }),
  });

  const guard = (permission: AuthzPermission) => ({
    meta: { policy: requires(permission) } satisfies ProjectEndpointMeta,
    permission,
  });

  return { service, guard };
}
