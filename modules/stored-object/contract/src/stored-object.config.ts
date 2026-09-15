import {
  Config,
  compileRuntimeConfig,
  environmentOneOrTrueSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * Selects backend storage (S3 or Azure) for externalized bytes.
 * Auth modes and per-org routes are interpreted per-backend, not in config.
 */
export const storedObjectServerConfigDefinition = RuntimeConfig.define({
  backend: Config.value(z.enum(["s3", "azure"]).optional(), { env: "STORED_OBJECTS_BACKEND" }),
  localFilesystemRoot: Config.value(z.string().optional(), {
    env: "LANGWATCH_LOCAL_STORAGE_PATH",
  }),
  /** Whether the Azure container reaps an orphaned trace spool object. */
  azureSpoolRetentionConfirmed: Config.value(environmentOneOrTrueSchema, {
    env: "AZURE_BLOB_SPOOL_RETENTION_CONFIRMED",
  }),
  s3: {
    bucket: Config.value(z.string().optional(), { env: "S3_BUCKET_NAME" }),
    endpoint: Config.value(z.string().optional(), { env: "S3_ENDPOINT" }),
    region: Config.value(z.string().optional(), { env: "S3_REGION" }),
    accessKeyId: Config.value(z.string().optional(), { env: "S3_ACCESS_KEY_ID" }),
    secretAccessKey: Config.value(z.string().optional(), { env: "S3_SECRET_ACCESS_KEY" }),
    sessionToken: Config.value(z.string().optional(), { env: "S3_SESSION_TOKEN" }),
  },
  azure: {
    authMode: Config.value(z.string().optional(), { env: "AZURE_BLOB_AUTH_MODE" }),
    accountName: Config.value(z.string().optional(), { env: "AZURE_BLOB_ACCOUNT_NAME" }),
    accountKey: Config.value(z.string().optional(), { env: "AZURE_BLOB_ACCOUNT_KEY" }),
    container: Config.value(z.string().optional(), { env: "AZURE_BLOB_CONTAINER" }),
    endpoint: Config.value(z.string().optional(), { env: "AZURE_BLOB_ENDPOINT" }),
    authorityHost: Config.value(z.string().optional(), { env: "AZURE_BLOB_AUTHORITY_HOST" }),
    tokenAudience: Config.value(z.string().optional(), { env: "AZURE_BLOB_TOKEN_AUDIENCE" }),
    allowInsecureTokenEndpointForTests: Config.value(z.string().optional(), {
      env: "AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS",
    }),
    identity: {
      tenantId: Config.value(z.string().optional(), { env: "AZURE_TENANT_ID" }),
      clientId: Config.value(z.string().optional(), { env: "AZURE_CLIENT_ID" }),
      federatedTokenFile: Config.value(z.string().optional(), {
        env: "AZURE_FEDERATED_TOKEN_FILE",
      }),
    },
  },
});

export type StoredObjectServerConfig = ConfigValue<typeof storedObjectServerConfigDefinition>;

export const storedObjectServerConfigSchema = compileRuntimeConfig(
  storedObjectServerConfigDefinition,
);
