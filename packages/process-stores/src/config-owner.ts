import { Config, type ProcessConfigOf } from "@langwatch/config";
import { Secret, sessionSecret } from "@langwatch/secrets";
import { z } from "zod";

export const storesOwner = {
  name: "stores",
  config: Config.define((c) => ({
    defaultRetentionDays: c.env(
      "DEFAULT_RETENTION_DAYS",
      z.coerce.number().int().positive().default(30),
    ),
    clickhousePool: {
      override: c.env("CLICKHOUSE_MAX_OPEN_CONNECTIONS", z.coerce.number().optional()),
      replicas: c.env("CLICKHOUSE_CLIENT_REPLICAS", z.coerce.number().optional()),
      serverMaxConcurrentQueries: c.env(
        "CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES",
        z.coerce.number().optional(),
      ),
      serverNodes: c.env("CLICKHOUSE_SERVER_NODES", z.coerce.number().optional()),
      clientsPerProcess: c.env("CLICKHOUSE_CLIENTS_PER_PROCESS", z.coerce.number().optional()),
    },
    rateLimit: {
      requests: c.env("API_RATE_LIMIT_REQUESTS", z.coerce.number().int().positive().default(60)),
      seconds: c.env("API_RATE_LIMIT_SECONDS", z.coerce.number().int().positive().default(60)),
    },
    objectStorage: {
      backend: c.env("STORED_OBJECTS_BACKEND", z.enum(["s3", "azure", "file"]).optional()),
      localRoot: c.env("LANGWATCH_LOCAL_STORAGE_PATH", z.string().optional()),
      s3: {
        bucket: c.env("S3_BUCKET_NAME", z.string().optional()),
        endpoint: c.env("S3_ENDPOINT", z.string().optional()),
        region: c.env("S3_REGION", z.string().optional()),
      },
      azure: {
        authMode: c.env("AZURE_BLOB_AUTH_MODE", z.string().optional()),
        accountName: c.env("AZURE_BLOB_ACCOUNT_NAME", z.string().optional()),
        container: c.env("AZURE_BLOB_CONTAINER", z.string().optional()),
        endpoint: c.env("AZURE_BLOB_ENDPOINT", z.string().optional()),
        authorityHost: c.env("AZURE_BLOB_AUTHORITY_HOST", z.string().optional()),
        tokenAudience: c.env("AZURE_BLOB_TOKEN_AUDIENCE", z.string().optional()),
        allowInsecureTokenEndpointForTests: c.env(
          "AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS",
          z.string().optional(),
        ),
        identity: {
          tenantId: c.env("AZURE_TENANT_ID", z.string().optional()),
          clientId: c.env("AZURE_CLIENT_ID", z.string().optional()),
          federatedTokenFile: c.env("AZURE_FEDERATED_TOKEN_FILE", z.string().optional()),
        },
      },
    },
  })),
  secrets: {
    database: Secret.load("DATABASE_URL", { optional: true }),
    clickhouse: Secret.load("CLICKHOUSE_URL", { optional: true }),
    redis: Secret.load("REDIS_URL", { optional: true }),
    encryption: Secret.load("CREDENTIALS_SECRET", { optional: true }),
    encryptionFallback: sessionSecret,
    s3AccessKeyId: Secret.load("S3_ACCESS_KEY_ID", { optional: true }),
    s3SecretAccessKey: Secret.load("S3_SECRET_ACCESS_KEY", { optional: true }),
    s3SessionToken: Secret.load("S3_SESSION_TOKEN", { optional: true }),
    azureAccountKey: Secret.load("AZURE_BLOB_ACCOUNT_KEY", { optional: true }),
  },
} as const;
export type StoresConfig = ProcessConfigOf<readonly [typeof storesOwner]>["stores"];
