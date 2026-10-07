/**
 * Overrides for the test suite views, and eventing's declared event tables (Q205). The retired
 * `automation_audit` table is not catalogued: its writer is gone (ADR-052
 * 2026-07 amendment); firing history is `GET /api/triggers/:id/fires`.
 */

import { LWQL_CLICKHOUSE_EVENT_TABLES } from "./lwql-catalogue.rules.ts";
import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

export const AUDIT_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  suite_runs: {
    description: "Test suite execution results with completion and pass counts",
    grain: "one row per (ScenarioSetId, BatchRunId)",
    timeColumn: "StartedAt",
    dedup: { versionColumn: "UpdatedAt" },
  },
  ...LWQL_CLICKHOUSE_EVENT_TABLES.overrides,
};
