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
 * Importing this helper is what POPULATES the registry, so the reads below see
 * every mounted route. Two things populate it, because routes reach it two
 * ways: the families that still live in this application register at
 * module-load time (the `~/server/api-router` import), and the families that
 * live in `@langwatch/platform-api` register when they are BUILT, which
 * `createAppRestFeatures` does here with providers that never have to resolve.
 * Both are top-level (the repo bans inline `import()`).
 *
 * `createAppRestFeatures` is the packaged families' single enumeration — the
 * same one the API router mounts — so a family cannot be served while being
 * invisible to this audit.
 */
import "~/server/api-router";

import { allRegisteredRoutes, isApiKeyReachable, policyPermissions } from "@langwatch/api";
import {
  createAppRestFeatures,
  servicesUnavailableOffRequestPath,
} from "@langwatch/platform-api/app-rest";

import { appRestSecurity } from "~/server/api/security";

createAppRestFeatures({
  security: appRestSecurity,
  services: servicesUnavailableOffRequestPath("while auditing the route registry"),
});

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
