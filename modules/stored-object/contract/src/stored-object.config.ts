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

/**
 * The operator's statement that every oversized-payload prefix has its lifecycle rule (ADR-172).
 * Stored-object owns the leaves; trace holds the same instances, since its spool is one of those
 * prefixes, so each variable keeps one meaning.
 */
export const { objectRetentionConfirmed, legacySpoolRetentionConfirmed } = Config.define((c) => ({
  objectRetentionConfirmed: c.env("OBJECT_RETENTION_CONFIRMED", confirmationSchema),
  /** The earlier spool-only spelling; stops being read in 3.23 (two after 3.21). */
  legacySpoolRetentionConfirmed: c.env("AZURE_BLOB_SPOOL_RETENTION_CONFIRMED", confirmationSchema),
}));

/** Object storage's own settings belong to the stores owner (ADR-158 §7). */
export const storedObjectConfig = Config.define(() => ({
  objectRetentionConfirmed,
  legacySpoolRetentionConfirmed,
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
