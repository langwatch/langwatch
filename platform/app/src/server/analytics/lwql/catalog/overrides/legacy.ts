/**
 * Overrides for the pre-canonical, per-tenant tables that stayed on the
 * derived catalog once "all data is customer data" moved them off the skip
 * list (#8085).
 *
 * `stored_log_records` and `stored_metric_records` predate the canonical
 * `log_records` / `metric_data_points` tables (see the "lossy ... remains for
 * rolling-deployment reads" note in
 * `00050_create_canonical_logs.sql`) but still carry real per-tenant rows, so
 * they are exposed rather than skipped. Only `stored_log_records` actually
 * collides under {@link defaultDatasetName} — stripping its `stored_` prefix
 * yields `log_records`, the name the canonical `log_records` table's own
 * derived view already takes. `stored_metric_records` would default to
 * `metric_records`, which nothing else claims, but it is named the same way
 * here for symmetry with its twin and so a reader sees at a glance that both
 * are the same generation of table.
 */

import type { DatasetOverride } from "../defineDatasetFromTable";

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
