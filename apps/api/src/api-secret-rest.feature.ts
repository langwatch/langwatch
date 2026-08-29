import { createRestService, RestVersionSelector } from "@langwatch/api/rest";
import type { SecretService } from "@langwatch/secret-contract";
import { SecretApp, SecretPublicRestApi } from "@langwatch/secret-server";
import { Hono } from "hono";
import { ApiRestSecurityPolicy, type ApiRestSecurityPort } from "./api-rest.security";

const restVersionSelector = RestVersionSelector.create({
  versions: ["v1"],
  latestVersion: "v1",
});

/** Installs all deployed Secret REST base paths over one composed service instance. */
export class ApiSecretRestFeature {
  static create(options: { secrets: SecretService; security: ApiRestSecurityPort }): Hono {
    const application = SecretApp.create({ secrets: options.secrets });
    const security = ApiRestSecurityPolicy.create(options.security);

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
          security,
        }),
      )
      .route(
        "/",
        buildSecretRestApi({
          application,
          basePath: "/api/secrets",
          operationIdSuffix: "LegacyPluralAlias",
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
  security: ApiRestSecurityPolicy;
}): Hono {
  const rest = createRestService<SecretApp>({
    name: "secret",
    basePath: options.basePath,
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
  })
    .withoutRateLimit("No public REST rate limiter is composed yet.")
    .withoutResourceLimit("Secret limits are domain invariants enforced by the canonical service.");

  return SecretPublicRestApi.create()
    .install(rest, { operationIdSuffix: options.operationIdSuffix })
    .build();
}
