/**
 * The REST families the API process mounts from its OWN graph.
 *
 * Two lists rather than one, and the split is by what a mount costs.
 * {@link createAppRestFeatures} enumerates the thirty-two families that belong
 * to a feature package, and it is all-or-nothing: calling it means holding
 * every one of those services, which the API process does not yet. This list
 * is the one it can actually build — the families that describe the process
 * (the API document), and the product families whose service this process has
 * already composed.
 *
 * The invariant both lists keep is the same one, and it is the reason this is a
 * list at all. A family reaches the route-policy registry when it is BUILT, and
 * the registry is what the route-authorization audit reads — so a family that
 * is served must appear in an enumeration, and mounting is iterating one.
 * Adding an `api.route(...)` beside these instead of an entry here is the thing
 * to refuse.
 *
 * A service this process did not compose leaves its family OUT rather than
 * mounting it over a throwing stub: a route that exists and answers 500 is
 * worse than one that is honestly not there, and the composition says which
 * ones and why at boot.
 */
import type { AnnotationApp } from "@langwatch/annotation-server";
import { createAnnotationsRestApp } from "@langwatch/annotation-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { createApiDiscoveryRestApp } from "../features/discovery/api-discovery-rest";
import { createGatewayOpenApiRestApp } from "../features/discovery/gateway-openapi-rest";
import { createRootDiscoveryRestApp } from "../features/discovery/root-discovery-rest";
import type { RumRateLimiter } from "../features/rum/rum-ingest.service";
import { createRumRestApp } from "../features/rum/rum-rest";

/**
 * The project credential a handler-managed family resolves through.
 *
 * The API process's one implementation is `ApiHandlerManagedCredentials`; the
 * shape is restated here rather than imported from one family's package so a
 * second family taking the same port does not have to depend on the first.
 */
export type ApiHandlerManagedCredentialPort = (input: {
  request: Request;
  permission: AuthzPermission;
}) => Promise<
  | Readonly<{ ok: true; project: Readonly<{ id: string }>; markUsed: () => void }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>
>;

/**
 * The product services this process may or may not have composed. Each is a
 * provider for the same reason the packaged list's are: mounting a family must
 * not force its service to be constructed.
 */
export type ApiProcessRestServices = Readonly<{
  /** The reviewer's comments `/api/annotations` reads and writes. */
  annotations?: (() => AnnotationApp) | undefined;
}>;

export type ApiProcessRestPorts = Readonly<{
  /**
   * Resolves a project API key and enforces one permission as a key ceiling,
   * answering the legacy refusal bodies the handler-managed families publish.
   */
  handlerManagedCredential: ApiHandlerManagedCredentialPort;
  /**
   * The process's ONE fixed-window counter. Shared rather than per-family: two
   * instances would give one caller two budgets for the same rule.
   */
  rateLimit: RumRateLimiter;
}>;

/**
 * Every REST family this process builds for itself, in mount order.
 *
 * ORDERING is load-bearing and is the order of this array:
 *
 *  1. `gateway-openapi` before anything else under `/api/gateway/v1`. The
 *     unauthenticated spec document shares that namespace with the
 *     credentialed gateway resource routes, so it must not be shadowed by a
 *     sibling that grows a parameterised segment at the root of it.
 *  2. `api-discovery` and `root-discovery`, which own literal paths in
 *     namespaces nothing else claims and are order-free between themselves.
 *  3. `rum`, which owns `/api/rum` outright.
 *  4. The product families. `/api/annotations` owns a literal first segment,
 *     so it neither shadows nor is shadowed by anything above it.
 */
export function createApiProcessRestFeatures(options: {
  security: AppRestSecurity;
  services?: ApiProcessRestServices;
  ports: ApiProcessRestPorts;
}): MountableRestApp[] {
  const { security, ports } = options;
  const services = options.services ?? {};
  const features: MountableRestApp[] = [
    createGatewayOpenApiRestApp({ security }),
    createApiDiscoveryRestApp({ security }),
    createRootDiscoveryRestApp({ security }),
    createRumRestApp({ security, rateLimit: ports.rateLimit }),
  ];

  const annotations = services.annotations;
  if (annotations) {
    features.push(
      createAnnotationsRestApp({
        security,
        annotations,
        credential: ports.handlerManagedCredential,
      }),
    );
  }

  return features;
}
