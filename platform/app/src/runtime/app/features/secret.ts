import { RestVersionSelector } from "@langwatch/api";
import type { SecretService } from "@langwatch/secret-contract";
import {
  PostgresSecretAdapter,
  SecretEncryptionPort,
  SecretPublicRestApi,
} from "@langwatch/secret-server";
import { Hono } from "hono";
import type { PrismaClient } from "~/generated/prisma/client";
import { createProjectRestApiService } from "~/server/api/project-service";
import { RESERVED_PROJECT_SECRET_NAMES } from "~/server/projects/reserved-secret-names";
import { decrypt, encrypt } from "~/utils/encryption";

const restVersionSelector = RestVersionSelector.create({
  versions: ["v1"],
  latestVersion: "v1",
});

function buildSecretRestApp(
  options: {
    basePath?: string;
    operationIdSuffix?: string;
    pathVersion?: "v1";
  } = {},
) {
  const rest = createProjectRestApiService({
    name: "secret",
    basePath: options.basePath ?? "/api/v1/secret",
    staticVersioning: {
      selector: restVersionSelector,
      ...(options.pathVersion ? { pathVersion: options.pathVersion } : {}),
    },
    maxInputBytes: 16 * 1024,
    openapiUrl: "/api/openapi.json",
    rateLimitOptOut: "No public REST rate limiter is composed yet.",
    resourceLimitOptOut: "Secret limits are domain invariants enforced by the canonical service.",
  });

  return SecretPublicRestApi.create()
    .install(rest, { operationIdSuffix: options.operationIdSuffix })
    .build();
}

/** Direct REST collection/item roots. The singular v1 path is canonical. */
export const secretPublicRestApp = new Hono()
  .route("/", buildSecretRestApp({ pathVersion: "v1" }))
  .route(
    "/",
    buildSecretRestApp({
      basePath: "/api/v1/secrets",
      operationIdSuffix: "PluralAlias",
      pathVersion: "v1",
    }),
  )
  .route(
    "/",
    buildSecretRestApp({
      basePath: "/api/secret",
      operationIdSuffix: "UnversionedAlias",
    }),
  );

class AppSecretEncryptionPort extends SecretEncryptionPort {
  encrypt(value: string): string {
    return encrypt(value);
  }

  decrypt(value: string): string {
    return decrypt(value);
  }
}

export class AppSecretRuntime {
  private constructor() {}

  static create(options: { database: PrismaClient }): SecretService {
    return PostgresSecretAdapter.create({
      database: options.database,
      encryption: new AppSecretEncryptionPort(),
      reservedNames: RESERVED_PROJECT_SECRET_NAMES,
    }).build();
  }
}
