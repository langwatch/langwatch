/**
 * Shared route-registry reads for the Langy permission suites.
 *
 * Both suites need "what does the mounted API actually demand?", and they had
 * grown their own copy of the walk. Two copies of a registry read is the same
 * failure mode the suites exist to prevent: they drift, and the one that drifts
 * keeps passing. One copy, imported by both.
 *
 * Not a `*.test.ts` file on purpose — it holds no assertions, only the reads.
 */
import { policyPermissions } from "~/server/api/security/access-policy";
import { allRegisteredRoutes } from "~/server/api/security/route-registry";

/**
 * The registry is populated as a side effect of the app modules loading, so
 * every read here imports the composed router first. Idempotent — the module
 * cache makes repeat calls free.
 */
async function loadRouter(): Promise<void> {
  await import("~/server/api-router");
}

/**
 * Every RBAC permission the mounted API demands, mapped to the routes demanding
 * it, so a failure can name the endpoint rather than just the permission.
 */
export async function permissionsDemandedByRoutes(): Promise<
  Map<string, string[]>
> {
  await loadRouter();
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
 * The `/api/experiments` routes that authenticate by USER SESSION rather than by
 * API key. Langy reaches the surface with a key, so it never calls these — and
 * `/execute` legitimately demands `evaluations:manage`, which the Langy key must
 * never hold.
 *
 * Enumerated by path, which is a known weakness: a new session-authenticated
 * route under `/api/experiments` will not be listed, and the session-key suite
 * will then demand the Langy key clear a grain it should never hold. The durable
 * fix is for the policy to record the CREDENTIAL TYPE alongside the permissions,
 * so this becomes a structural filter instead of a list. Tracked separately.
 */
const SESSION_ONLY_EXPERIMENT_ROUTES = [
  "/api/experiments/execute",
  "/api/experiments/abort",
];

/**
 * The permissions the API-key-reachable experiment routes demand, read from the
 * registry rather than hardcoded.
 *
 * Hardcoding them would have missed half of the original bug: the run route
 * asked `evaluations:manage`, a grain no least-privilege key can hold, and a
 * fixed list would have kept asserting the grain we wished for instead of the
 * one the route enforces.
 */
export async function experimentRoutePermissions(): Promise<string[]> {
  await loadRouter();
  const permissions = new Set<string>();
  for (const route of allRegisteredRoutes()) {
    if (!route.path.startsWith("/api/experiments")) continue;
    if (SESSION_ONLY_EXPERIMENT_ROUTES.includes(route.path)) continue;
    for (const permission of policyPermissions(route.policy)) {
      permissions.add(permission);
    }
  }
  return [...permissions].sort();
}
