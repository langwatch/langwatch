import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  isSaas,
  publicBaseUrl,
  type ConfigOf,
} from "@langwatch/config";
import { z } from "zod";

/** "1" or "true" confirms, any other value refuses, and an absent variable stays absent. */
const confirmationSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) =>
    value === undefined
      ? undefined
      : value === true ||
        (typeof value === "string" && ["1", "true"].includes(value.toLowerCase())),
  );

/** Object storage's own settings belong to the stores owner (ADR-158 §7). */
export const storedObjectConfig = Config.define((c) => ({
  /** The operator states every oversized-payload prefix has its lifecycle rule (ADR-172). */
  objectRetentionConfirmed: c.env("OBJECT_RETENTION_CONFIRMED", confirmationSchema),
  /** The earlier spool-only spelling of the same statement, honoured until the LTS floor. */
  legacySpoolRetentionConfirmed: c.env("AZURE_BLOB_SPOOL_RETENTION_CONFIRMED", confirmationSchema),
  /** The address fence the image proxy judges an outbound picture by. */
  blockLocalHttpCalls,
  allowedProxyHosts,
  /** The hosted product, whose image proxy verifies the TLS of every outside picture. */
  isSaas,
  /** The deployment's public origin; the local backend's upload URL is built on it. */
  publicBaseUrl,
}));

export type StoredObjectServerConfig = ConfigOf<typeof storedObjectConfig>;

/** The new variable decides when it is set; otherwise the earlier one; neither refuses. */
export function isObjectRetentionConfirmed({
  config,
}: {
  config: Pick<
    StoredObjectServerConfig,
    "objectRetentionConfirmed" | "legacySpoolRetentionConfirmed"
  >;
}): boolean {
  return config.objectRetentionConfirmed ?? config.legacySpoolRetentionConfirmed ?? false;
}
