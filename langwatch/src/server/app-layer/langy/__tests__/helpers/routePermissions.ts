/**
 * Shared route-registry reads for the Langy permission suites.
 *
 * Both suites need "what does the mounted API actually demand?", and they had
 * grown their own copy of the walk. Two copies of a registry read is the same
 * failure mode the suites exist to prevent: they drift, and the one that drifts
 * keeps passing. One copy, imported by both.
 *
 * Not a `*.test.ts` file on purpose — it holds no assertions, only the reads.
 *
 * The `~/server/api-router` import is what POPULATES the registry: each app
 * module registers its routes at module-load time. It is a top-level import
 * (the repo bans inline `import()`), so simply importing this helper is enough
 * for the reads below to see every mounted route.
 */
import "~/server/api-router";

import {
  isApiKeyReachable,
  policyPermissions,
} from "~/server/api/security/access-policy";
import { allRegisteredRoutes } from "~/server/api/security/route-registry";

/**
 * Every RBAC permission the mounted API demands, mapped to the routes demanding
 * it, so a failure can name the endpoint rather than just the permission.
 */
export function permissionsDemandedByRoutes(): Map<string, string[]> {
  const demanded = new Map<string, string[]>();
  for (const route of allRegisteredRoutes()) {
    for (const permission of policyPermissions(route.policy)) {
      const where = `${route.method} ${route.path}`;
      demanded.set(permission, [...(demanded.get(permission) ?? []), where]);
    }
  }
  return demanded;
}

/**
 * The permissions the experiment routes demand of a caller holding an API KEY —
 * which is what Langy carries.
 *
 * Reachability comes from the route's own policy (`credential`), not from a
 * list of session-only paths kept here. That list was the last hand-maintained
 * thing in this PR and it had the failure mode the PR exists to remove: add or
 * rename a session-only route and it is silently misclassified, at which point
 * this suite starts demanding the Langy key clear a grain it must never hold.
 *
 * The grains themselves are read from the registry rather than hardcoded.
 * Hardcoding them would have missed half of the original bug: the run route
 * asked `evaluations:manage`, a grain no least-privilege key can hold, and a
 * fixed list would have kept asserting the grain we wished for instead of the
 * one the route enforces.
 */
export function experimentRoutePermissions(): string[] {
  const permissions = new Set<string>();
  for (const route of allRegisteredRoutes()) {
    if (!route.path.startsWith("/api/experiments")) continue;
    if (!isApiKeyReachable(route.policy)) continue;
    for (const permission of policyPermissions(route.policy)) {
      permissions.add(permission);
    }
  }
  return [...permissions].sort();
}
