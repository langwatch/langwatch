/**
 * Putting the mounts a `@langwatch/api` service creates into the route-policy
 * registry.
 *
 * Two service factories build on the framework — the organization-key
 * management families and the project-key v1 families — and both have to feed
 * the same registry the authorization audit reads
 * (`api-endpoint-authorization.integration.test.ts`). The namespace-guard
 * handling, the "an endpoint must declare a policy" refusal and the
 * policy/permission cross-check are one implementation here, so the two
 * factories cannot drift into classifying the same shape two ways.
 *
 * Every mount the framework creates arrives here: each dated version, `latest`,
 * the bare alias, withdrawn 410 tombstones (their inherited config carries the
 * meta), and the two version-namespace guards.
 */
import type { MountedRoute } from "@langwatch/api";

import {
  type AccessPolicy,
  credentialClassFor,
  publicEndpoint,
  registerRoutePolicy,
} from "~/server/api/security";

/**
 * The per-endpoint meta contract a service factory reads back on
 * `onRouteMounted`. Produced by the factory's `guard(...)`; an endpoint whose
 * config lacks it fails the build, so a route cannot reach the router
 * unclassified.
 */
export interface ServiceEndpointMeta {
  policy: AccessPolicy;
}

/** The credential family a service's routes authenticate with. */
export type ServiceScope = "project" | "organization";

/**
 * Puts one mount in the route-policy registry, refusing to classify a route
 * that never declared a policy.
 *
 * The non-wildcard namespace guard is a real, enumerable route in the Hono
 * route table, so it MUST be policy-registered or the authorization test
 * fails; it is registered as a public endpoint with the reason written out,
 * because it serves nothing but a 404 for unknown version segments.
 */
export function registerMountedRoute({
  route,
  family,
  scope,
  surface,
}: {
  route: MountedRoute;
  family: string;
  scope: ServiceScope;
  /** Names the family in a build refusal, e.g. "Management" or "Project". */
  surface: string;
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
      credentialClass: credentialClassFor({ scope, policy }),
    });
    return;
  }

  const meta = route.config?.meta as ServiceEndpointMeta | undefined;
  if (!meta?.policy) {
    throw new Error(
      `${surface} endpoint ${route.method.toUpperCase()} ${route.path} ` +
        `declares no access policy; spread guard(permission) into its ` +
        `endpoint config`,
    );
  }
  // The registry must never promise a check the pipeline does not mount: a
  // permission policy in `meta` is only honest when the SAME permission is on
  // `config.permission`, which is what the framework enforces from.
  if (
    meta.policy.kind === "permission" &&
    route.config?.permission !== meta.policy.permission
  ) {
    throw new Error(
      `${surface} endpoint ${route.method.toUpperCase()} ${route.path} ` +
        `declares policy "${meta.policy.permission}" but enforces ` +
        `"${route.config?.permission ?? "nothing"}"; both halves must come ` +
        `from the same guard(permission)`,
    );
  }
  registerRoutePolicy({
    method: route.method,
    path: route.path,
    policy: meta.policy,
    family,
    // The whole family authenticates with one key family, so the class is the
    // one a SecuredApp on that scope derives.
    credentialClass: credentialClassFor({ scope, policy: meta.policy }),
  });
}
