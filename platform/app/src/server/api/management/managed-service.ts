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
import type { MiddlewareHandler } from "hono";

import {
  type PlanEntitlementFlag,
  requireEnterprisePlanRest,
} from "~/app/api/middleware/enterprise-gate";
import { requireOrgPermissionOrThrow } from "~/app/api/middleware/org-auth";
import type { EnterpriseFeature } from "~/server/api/enterprise";
import type { Permission } from "~/server/api/rbac";
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
 * Marks a handler as one of the two `guard()` produces, so the mount callback
 * can check that the chain which ENFORCES a policy is still attached to the
 * route that DECLARES one.
 *
 * Without this the two halves can be separated silently: `meta.policy` is a
 * plain property, so `{ ...guard(p), middleware: [mine] }` keeps the
 * declaration and replaces the enforcement. The route-policy registry — and
 * `api-endpoint-authorization.integration.test.ts`, which audits the composed
 * router against that registry — read only the declaration, so both stay green
 * over an endpoint that authenticates and then admits anyone.
 */
const GUARD_ROLE = Symbol("managementGuardRole");

type GuardRole = "permission" | "plan";

function tagged(
  handler: MiddlewareHandler,
  role: GuardRole,
): MiddlewareHandler {
  return Object.assign(handler, { [GUARD_ROLE]: role });
}

function rolesOf(middleware: MiddlewareHandler[]): Set<GuardRole> {
  return new Set(
    middleware
      .map((handler) => (handler as { [GUARD_ROLE]?: GuardRole })[GUARD_ROLE])
      .filter((role): role is GuardRole => role !== undefined),
  );
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
  entitlement,
}: {
  name: string;
  /** Spelled out at the call site so the route-coverage gate can read it. */
  basePath: string;
  feature: EnterpriseFeature;
  /**
   * Admit on a per-feature plan flag rather than on the Enterprise tier, for a
   * feature that is licensable on its own. Omit for the usual tier gate.
   */
  entitlement?: PlanEntitlementFlag;
}) {
  const family = familyFromBasePath(basePath);

  const service = createService({
    name,
    basePath,
    auth: createOrgAuthMiddleware({ prisma, refusals: "throw" }),
    onRouteMounted: (route) => registerMountedRoute({ route, family }),
  });

  /**
   * Both halves of one endpoint's contract: the policy the registry records
   * and the chain that enforces it.
   *
   * `extra` exists so an endpoint that needs its own middleware — idempotency,
   * a rate limiter — can have it WITHOUT hand-writing the spread. Passing it
   * here is the only safe spelling. Writing
   * `{ ...guard(p), middleware: [mine] }` at the call site replaces this array
   * instead of extending it, which silently drops the permission check and the
   * plan gate while `meta.policy` still reports the endpoint as guarded — so
   * the route-policy registry, and the authorization test that reads it, stay
   * green over an endpoint that authenticates and then admits anyone.
   */
  const guard = (
    permission: Permission,
    { extra = [] }: { extra?: MiddlewareHandler[] } = {},
  ) => ({
    meta: { policy: requires(permission) } satisfies ManagementEndpointMeta,
    middleware: [
      tagged(requireOrgPermissionOrThrow(permission), "permission"),
      tagged(requireEnterprisePlanRest(feature, { entitlement }), "plan"),
      ...extra,
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
/**
 * The families that predate ADR-094 and still register resource-REST routes.
 * They keep working; the list is closed. Every family added after the webhooks
 * pilot registers with `v.rpc("/resource.verb")` only.
 *
 * `@langwatch/api` still exposes `v.get` / `v.post` / `v.patch` / `v.delete`,
 * because it is a general framework and SSE and the four families below need
 * them. What makes RPC the only way to add a LangWatch management endpoint is
 * this check rather than the package's surface: `createManagementService` is
 * the single product caller of `createService`, so every management route in
 * the app passes through here.
 *
 * Removing a name from this set is a port — the family's paths, SDKs, CLI and
 * published document all move — not a configuration change.
 */
const REST_LEGACY_FAMILIES = new Set([
  "organization",
  "role-bindings",
  "roles",
  "scim-tokens",
]);

/**
 * A new family may only mount RPC operations: a real POST whose last path
 * segment is a dotted `<resource>.<verb>` name. The package asserts that
 * grammar for anything registered through `v.rpc`; this asserts that nothing
 * in a new family was registered any other way.
 */
function assertRpcOnlyOutsideLegacyFamilies({
  route,
  family,
}: {
  route: MountedRoute;
  family: string;
}): void {
  if (REST_LEGACY_FAMILIES.has(family)) return;

  const operation = route.path.split("/").pop() ?? "";
  if (route.method === "post" && operation.includes(".")) return;

  throw new Error(
    `Management endpoint ${route.method.toUpperCase()} ${route.path} in ` +
      `family "${family}" is not RPC-named. Families added after the webhooks ` +
      `pilot register operations with v.rpc("/resource.verb") only (ADR-094); ` +
      `the resource-REST helpers remain only for ${[...REST_LEGACY_FAMILIES].join(", ")}`,
  );
}

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

  assertRpcOnlyOutsideLegacyFamilies({ route, family });

  const meta = route.config?.meta as ManagementEndpointMeta | undefined;
  if (!meta?.policy) {
    throw new Error(
      `Management endpoint ${route.method.toUpperCase()} ${route.path} ` +
        `declares no access policy; spread guard(permission) into its ` +
        `endpoint config`,
    );
  }
  // A withdrawn mount answers 410 without reaching the chain, so requiring the
  // guard handlers on it would fail the build over a route that runs nothing.
  if (!route.withdrawn) {
    const roles = rolesOf(route.config?.middleware ?? []);
    const missing = (["permission", "plan"] as const).filter(
      (role) => !roles.has(role),
    );
    if (missing.length > 0) {
      throw new Error(
        `Management endpoint ${route.method.toUpperCase()} ${route.path} ` +
          `declares an access policy but its middleware chain is missing the ` +
          `${missing.join(" and ")} check; pass extra middleware as ` +
          `guard(permission, { extra }) instead of overwriting "middleware"`,
      );
    }
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
