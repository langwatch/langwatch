/**
 * Factory for management API families on `@langwatch/api`.
 *
 * One declaration per endpoint has to feed two consumers that must never
 * disagree: the SecuredApp route-policy registry (what
 * `api-endpoint-authorization.integration.test.ts` audits the composed router
 * against) and the enforcement chain that actually refuses requests. The
 * `guard(permission)` helper returns both halves from the same permission, and
 * `onRouteMounted` registers the policy for every mount the framework creates:
 * each dated version, `latest`, the bare alias, withdrawn 410 tombstones (their
 * inherited config carries the meta), and the two version-namespace guards.
 *
 * The non-wildcard namespace guard is a real, enumerable route in the Hono
 * route table, so it MUST be policy-registered or the authorization test fails;
 * it is registered as a public endpoint with the reason written out, because it
 * serves nothing but a 404 for unknown version segments.
 */
import { createService, type MountedRoute } from "@langwatch/api";
import type { AuthzPermission } from "@langwatch/authz";
import { requireEnterprisePlanRest } from "~/app/api/middleware/enterprise-gate";
import { requireOrgPermissionOrThrow } from "~/app/api/middleware/org-auth";
import type { EnterpriseFeature } from "~/server/api/enterprise";
import {
  type AccessPolicy,
  credentialClassFor,
  familyFromBasePath,
  publicEndpoint,
  registerRoutePolicy,
  requires,
} from "~/server/api/security";
import { createOrgAuthMiddleware } from "~/server/api-key/auth-middleware";
import { prisma } from "~/server/db";

/**
 * The per-endpoint meta contract this factory reads back on
 * `onRouteMounted`. Produced by `guard(...)`; an endpoint whose config lacks
 * it fails the build, so a route cannot reach the router unclassified.
 */
export interface ManagementEndpointMeta {
  policy: AccessPolicy;
}

/**
 * A versioned management service with org-key auth in throw mode and a
 * policy-registering mount callback. Use the returned `guard(permission)` on
 * EVERY endpoint:
 *
 * ```ts
 * const { service, guard } = createManagementService({
 *   name: "roles",
 *   basePath: "/api/roles",
 *   feature: "RBAC",
 * });
 *
 * service.version(MANAGEMENT_API_VERSION, (v) => {
 *   v.get("/", { ...guard("organization:manage"), output, description, docs }, handler);
 * });
 * ```
 *
 * The enforcement order is fixed: org auth (service-level, throws
 * `missing_credentials` / `invalid_credentials` / `organization_not_found`),
 * then the RBAC check (403 `insufficient_permissions`), then the Enterprise
 * plan gate (402 `enterprise_plan_required`). "You don't have access" must
 * always beat "your plan doesn't include this", and both must come after
 * authentication, which is also what the plan gate needs to find the
 * organization on the context.
 */
export function createManagementService({
  name,
  basePath,
  feature,
}: {
  name: string;
  /** Spelled out at the call site so the route-coverage gate can read it. */
  basePath: string;
  feature: EnterpriseFeature;
}) {
  const family = familyFromBasePath(basePath);

  const service = createService({
    name,
    basePath,
    auth: createOrgAuthMiddleware({ prisma, refusals: "throw" }),
    onRouteMounted: (route) => registerMountedRoute({ route, family }),
  });

  const guard = (permission: AuthzPermission) => ({
    meta: { policy: requires(permission) } satisfies ManagementEndpointMeta,
    middleware: [
      requireOrgPermissionOrThrow(permission),
      requireEnterprisePlanRest(feature),
    ],
  });

  return { service, guard };
}

/**
 * Puts one mount in the route-policy registry, refusing to classify a route
 * that never declared a policy. Every mount the framework creates arrives
 * here: each dated version, `latest`, the bare alias, withdrawn 410 tombstones
 * (their inherited config carries the meta), and the two version-namespace
 * guards.
 */
function registerMountedRoute({
  route,
  family,
}: {
  route: MountedRoute;
  family: string;
}): void {
  if (route.isNamespaceGuard) {
    const policy = publicEndpoint(
      "version-namespace guard: answers 404 for unknown version segments " +
        "so they cannot fall through to a dynamic unversioned route; " +
        "reads no data and takes no credential",
    );
    registerRoutePolicy({
      method: route.method,
      path: route.path,
      policy,
      family,
      credentialClass: credentialClassFor({ scope: "organization", policy }),
    });
    return;
  }

  const meta = route.config?.meta as ManagementEndpointMeta | undefined;
  if (!meta?.policy) {
    throw new Error(
      `Management endpoint ${route.method.toUpperCase()} ${route.path} ` +
        `declares no access policy; spread guard(permission) into its ` +
        `endpoint config`,
    );
  }
  registerRoutePolicy({
    method: route.method,
    path: route.path,
    policy: meta.policy,
    family,
    // The whole family authenticates with an organization-scoped key, so the
    // class is the one a SecuredApp on the organization scope derives.
    credentialClass: credentialClassFor({
      scope: "organization",
      policy: meta.policy,
    }),
  });
}
