import { Config, environmentOneOrTrueSchema, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Selects backend storage (S3 or Azure) for externalized bytes. Credentials
 * resolve through the process's `secrets` member (ADR-132), never this slice.
 */
export const storedObjectConfig = Config.define((c) => ({
  backend: c.env("STORED_OBJECTS_BACKEND", z.enum(["s3", "azure"]).optional()),
  localFilesystemRoot: c.env("LANGWATCH_LOCAL_STORAGE_PATH", z.string().optional()),
  /** Whether the Azure container reaps an orphaned trace spool object. */
  azureSpoolRetentionConfirmed: c.env(
    "AZURE_BLOB_SPOOL_RETENTION_CONFIRMED",
    environmentOneOrTrueSchema,
  ),
  /** `accessKeyId`, `secretAccessKey` and `sessionToken` are secret handles, not leaves. */
  s3: {
    bucket: c.env("S3_BUCKET_NAME", z.string().optional()),
    endpoint: c.env("S3_ENDPOINT", z.string().optional()),
    region: c.env("S3_REGION", z.string().optional()),
  },
  /** `accountKey` is a secret handle, not a leaf. */
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
}));

export type StoredObjectServerConfig = ConfigOf<typeof storedObjectConfig>;
