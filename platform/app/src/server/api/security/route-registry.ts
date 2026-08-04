import type { AccessPolicy } from "./access-policy";

/**
 * Process-wide registry of every route declared through the secured app
 * builder. Populated at module-load time as each app file registers its routes.
 * The router-introspection guard test (api-endpoint-authorization.integration)
 * cross-checks the fully composed router against this registry so that ANY
 * mounted route lacking a declared policy fails CI — including a route that
 * bypassed the builder via raw Hono.
 */
export interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
  readonly policy: AccessPolicy;
  readonly family: string;
}

const registry = new Map<string, RegisteredRoute>();

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Record (or overwrite, idempotently) the policy for a (method, path). */
export function registerRoutePolicy(route: RegisteredRoute): void {
  registry.set(key(route.method, route.path), {
    ...route,
    method: route.method.toUpperCase(),
  });
}

export function getRoutePolicy(
  method: string,
  path: string,
): RegisteredRoute | undefined {
  return registry.get(key(method, path));
}

export function allRegisteredRoutes(): RegisteredRoute[] {
  return [...registry.values()];
}
