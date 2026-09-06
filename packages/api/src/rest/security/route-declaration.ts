import type { Hono } from "hono";

import type { RegisteredRoute } from "./route-registry.ts";

/**
 * The mounted route table a composed app publishes. Hono's own `routes` array,
 * named here so the assertion reads any app-shaped value without depending on
 * the generic parameters a family happens to carry.
 */
export type MountedRouteTable = Readonly<{
  routes: ReadonlyArray<{ method: string; path: string }>;
}>;

/**
 * A method-"ALL" route on a wildcard path is app-level middleware, a sub-app
 * mount, or a catch-all that terminates the request inside its own framework.
 * None is an enumerable endpoint, so neither side of the cross-check counts it.
 */
function isUnenumerableMount(method: string, path: string): boolean {
  return method.toUpperCase() === "ALL" && path.includes("*");
}

/**
 * Every address a registered route answers at: its own path and, when it has
 * one, the canonical `/api/v1` twin the builder recorded alongside it.
 */
function registeredAddresses(registry: readonly RegisteredRoute[]): Set<string> {
  const addresses = new Set<string>();
  for (const route of registry) {
    addresses.add(`${route.method.toUpperCase()} ${route.path}`);
    if (route.canonicalPath) {
      addresses.add(`${route.method.toUpperCase()} ${route.canonicalPath}`);
    }
  }
  return addresses;
}

/** Every mounted endpoint with no entry in the route registry, sorted. */
export function undeclaredRoutes(options: {
  app: MountedRouteTable | Hono<any, any, any>;
  registry: readonly RegisteredRoute[];
}): string[] {
  const declared = registeredAddresses(options.registry);
  const undeclared = new Set<string>();
  for (const route of options.app.routes) {
    if (isUnenumerableMount(route.method, route.path)) continue;
    const address = `${route.method.toUpperCase()} ${route.path}`;
    if (!declared.has(address)) undeclared.add(address);
  }
  return [...undeclared].sort();
}

/**
 * Refuses to finish booting while the process serves a route no access policy
 * covers — the mount-time twin of the type error and the builder's throw. A
 * plain `Error`: a wiring defect of ours, not one a caller can act on.
 */
export function assertEveryRouteDeclared(options: {
  app: MountedRouteTable | Hono<any, any, any>;
  registry: readonly RegisteredRoute[];
}): void {
  const undeclared = undeclaredRoutes(options);
  if (undeclared.length === 0) return;
  throw new Error(
    `REST routes mounted with no declared access policy: ${undeclared.join(", ")}. ` +
      "Register them through the secured app builder (createProjectApp / createOrgApp / " +
      "createServiceApp plus .access(...)). There is no allowlist.",
  );
}
