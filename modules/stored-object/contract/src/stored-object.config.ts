import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  environmentOneOrTrueSchema,
  isSaas,
  publicBaseUrl,
  type ConfigOf,
} from "@langwatch/config";

/** Object storage's own settings belong to the stores owner (ADR-158 §7). */
export const storedObjectConfig = Config.define((c) => ({
  /** Whether the Azure container reaps an orphaned trace spool object. */
  azureSpoolRetentionConfirmed: c.env(
    "AZURE_BLOB_SPOOL_RETENTION_CONFIRMED",
    environmentOneOrTrueSchema,
  ),
  /** The address fence the image proxy judges an outbound picture by. */
  blockLocalHttpCalls,
  allowedProxyHosts,
  /** The hosted product, whose image proxy verifies the TLS of every outside picture. */
  isSaas,
  /** The deployment's public origin; the local backend's upload URL is built on it. */
  publicBaseUrl,
}));

export type StoredObjectServerConfig = ConfigOf<typeof storedObjectConfig>;
