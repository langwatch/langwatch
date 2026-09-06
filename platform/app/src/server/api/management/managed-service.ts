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
import { createService } from "@langwatch/api";
import type { AuthzPermission } from "@langwatch/authz";
import { appContextMiddleware } from "~/app/api/middleware/app-context";
import { requireEnterprisePlanRest } from "~/app/api/middleware/enterprise-gate";
import { requireOrgPermissionOrThrow } from "~/app/api/middleware/org-auth";
import type { EnterpriseFeature } from "~/server/api/enterprise";
import {
  registerMountedRoute,
  type ServiceEndpointMeta,
} from "~/server/api/route-mount-registry";
import { familyFromBasePath, requires } from "~/server/api/security";
import { createOrgAuthMiddleware } from "~/server/api-key/auth-middleware";
import { prisma } from "~/server/db";

/** @see ServiceEndpointMeta, which this family's `guard(...)` produces. */
export type ManagementEndpointMeta = ServiceEndpointMeta;

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
    middleware: [appContextMiddleware],
    auth: createOrgAuthMiddleware({ prisma, refusals: "throw" }),
    // The framework mounts this for every endpoint that declares a
    // `permission`, between auth and the endpoint's own middleware. The
    // enforcement runs through the App-composed permissions service
    // (`requireOrgPermissionOrThrow` → `getApp().permissions`), and because
    // the framework owns the mounting, an endpoint's `middleware` array can
    // no longer displace the check its declared policy promises.
    permissionEnforcer: (permission) => requireOrgPermissionOrThrow(permission),
    onRouteMounted: (route) =>
      registerMountedRoute({
        route,
        family,
        scope: "organization",
        surface: "Management",
      }),
  });

  const guard = (permission: AuthzPermission) => ({
    meta: { policy: requires(permission) } satisfies ManagementEndpointMeta,
    permission,
    middleware: [requireEnterprisePlanRest(feature)],
  });

  return { service, guard };
}
