import { Config, environmentOneOrTrueSchema, type ConfigOf } from "@langwatch/config";

/** Object storage's own settings belong to the stores owner (ADR-158 §7). */
export const storedObjectConfig = Config.define((c) => ({
  /** Whether the Azure container reaps an orphaned trace spool object. */
  azureSpoolRetentionConfirmed: c.env(
    "AZURE_BLOB_SPOOL_RETENTION_CONFIRMED",
    environmentOneOrTrueSchema,
  ),
}));

export type StoredObjectServerConfig = ConfigOf<typeof storedObjectConfig>;
