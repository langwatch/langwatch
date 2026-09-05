import { apiKeyPermission, credentialClassFor, publicEndpoint } from "@langwatch/api";
import {
  createRestService,
  registerRoutePolicy,
  RestVersionSelector,
  type MountedRoute,
} from "@langwatch/api/rest";
import type { SecretService } from "@langwatch/secret-contract";
import { SecretApp, SecretPublicRestApi } from "@langwatch/secret-server";
import { Hono } from "hono";
import type { ApiRestProjectPolicy } from "./api-rest.security";

const restVersionSelector = RestVersionSelector.create({
  versions: ["v1"],
  latestVersion: "v1",
});

/** Installs all deployed Secret REST base paths over one composed service instance. */
export class ApiSecretRestFeature {
  static create(options: { secrets: SecretService; security: ApiRestProjectPolicy }): Hono {
    const application = SecretApp.create({ secrets: options.secrets });
    const security = options.security;

    return new Hono()
      .route(
        "/",
        buildSecretRestApi({
          application,
          basePath: "/api/v1/secret",
          pathVersion: "v1",
          security,
        }),
      )
      .route(
        "/",
        buildSecretRestApi({
          application,
          basePath: "/api/v1/secrets",
          operationIdSuffix: "PluralAlias",
          pathVersion: "v1",
          security,
        }),
      )
      .route(
        "/",
        buildSecretRestApi({
          application,
          basePath: "/api/secret",
          operationIdSuffix: "UnversionedAlias",
          // This fan-out mounts its own /api/v1 pair above; no derived twin.
          v1Alias: false,
          security,
        }),
      )
      .route(
        "/",
        buildSecretRestApi({
          application,
          basePath: "/api/secrets",
          operationIdSuffix: "LegacyPluralAlias",
          v1Alias: false,
          security,
        }),
      );
  }
}

function buildSecretRestApi(options: {
  application: SecretApp;
  basePath: string;
  operationIdSuffix?: string;
  pathVersion?: "v1";
  security: ApiRestProjectPolicy;
  v1Alias?: boolean;
}): Hono {
  const rest = createRestService<SecretApp>({
    name: "secret",
    basePath: options.basePath,
    ...(options.v1Alias === false ? { v1Alias: false } : {}),
    staticVersioning: {
      selector: restVersionSelector,
      ...(options.pathVersion ? { pathVersion: options.pathVersion } : {}),
    },
    maxInputBytes: 16 * 1024,
    app: () => options.application,
    actor: (context) => options.security.actor(context),
    authorize: (context, permission) => options.security.authorize(context, permission),
    auth: options.security.authenticationMiddleware(),
    permissionEnforcer: (permission) => options.security.permissionMiddleware(permission),
    projectIdInput: true,
    openapiSecurity: [{ project_api_key: [] }],
    onRouteMounted: (route) => registerSecretRoutePolicy(route),
  })
    .withoutRateLimit("No public REST rate limiter is composed yet.")
    .withoutResourceLimit("Secret limits are domain invariants enforced by the canonical service.");

  return SecretPublicRestApi.create()
    .install(rest, { operationIdSuffix: options.operationIdSuffix })
    .build();
}

/**
 * Puts one secret mount in the route-policy registry. The typed REST service enforces the
 * permission it declares per endpoint; without this the routes are served with a real
 * check and no recorded policy, which is the one state the endpoint-authorization audit
 * cannot tell apart from a route that bypassed the builder.
 */
function registerSecretRoutePolicy(route: MountedRoute): void {
  const policy = route.isNamespaceGuard
    ? publicEndpoint(
        "version-namespace guard: answers 404 for unknown version segments so they " +
          "cannot fall through to a dynamic route; reads no data and takes no credential",
      )
    : route.config?.permission
      ? apiKeyPermission(route.config.permission)
      : undefined;
  if (!policy) {
    throw new Error(
      `Secret endpoint ${route.method.toUpperCase()} ${route.path} declares no permission`,
    );
  }

  registerRoutePolicy({
    method: route.method.toUpperCase(),
    path: route.path,
    ...(route.canonicalPath ? { canonicalPath: route.canonicalPath } : {}),
    policy,
    family: "secret",
    credentialClass: credentialClassFor({ scope: "project", policy }),
  });
}
