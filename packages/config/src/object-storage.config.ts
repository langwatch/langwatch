import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * Where a deployment keeps the bytes it externalizes out of traces, datasets,
 * scenarios and evaluation payloads, and the Azure Blob identity it reads and
 * writes that backend through — the whole shape every process that resolves
 * object storage binds identically.
 *
 * `backend` is a SELECTION rather than a fallback chain: a deployment that
 * named `azure` means it, and resolving a project to S3 because an S3 bucket
 * also happens to be configured would write a tenant's bytes into a bucket
 * nothing reads them back from. The absence of every S3 value is likewise not
 * "use the shared bucket" — it is the documented single-replica filesystem
 * fallback, which the destination policy owns.
 *
 * `azure` is read together and interpreted nowhere here: which of the four
 * auth modes applies, which variables each one requires, and whether a
 * plaintext endpoint or a sovereign cloud is admissible are the stored object
 * feature's own rules. `identity` is the AKS azure-workload-identity webhook's
 * own three variables, named here because a process's config module is its
 * only environment reader, not because an operator sets them directly.
 *
 * Per-organization S3 ROUTES are not here: their names carry the organization
 * id (`DATAPLANE_S3__<label>__<organizationId>`), so a declarative projection
 * can only name variables it knows in advance, and every process parses them
 * off the raw environment with the shared `parseDataplaneS3RoutingTable`
 * helper instead.
 */
export const objectStorageConfigDefinition = RuntimeConfig.define({
  backend: Config.value(z.enum(["s3", "azure"]).optional(), { env: "STORED_OBJECTS_BACKEND" }),
  localFilesystemRoot: Config.value(z.string().optional(), {
    env: "LANGWATCH_LOCAL_STORAGE_PATH",
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
