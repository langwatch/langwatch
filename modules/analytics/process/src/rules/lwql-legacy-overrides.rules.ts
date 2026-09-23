/**
 * Overrides for the pre-canonical, per-tenant tables that stayed on the derived catalog once "all
 * data is customer data" moved them off the skip list (#8085).
 */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

export const LEGACY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  stored_log_records: {
    name: "legacy_log_records",
    description:
      "Pre-canonical OpenTelemetry log record storage, superseded by " +
      "log_records; retained for rolling-deployment reads and draining " +
      "under its own TTL.",
    timeColumn: "TimeUnixMs",
    dedup: { versionColumn: "UpdatedAt" },
    columnUnits: {
      TimeUnixMs: "ms",
    },
  },
  stored_metric_records: {
    name: "legacy_metric_records",
    description:
      "Pre-canonical OpenTelemetry metric record storage, superseded by " +
      "the metric_data_points family; retained for rolling-deployment reads " +
      "and draining under its own TTL.",
    timeColumn: "TimeUnixMs",
    dedup: { versionColumn: "UpdatedAt" },
    columnUnits: {
      TimeUnixMs: "ms",
    },
  },
};
