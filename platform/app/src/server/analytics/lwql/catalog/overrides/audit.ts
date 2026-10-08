/**
 * Overrides for the test suite and legacy event log views. The retired
 * `automation_audit` table is not catalogued: its writer is gone (ADR-052
 * 2026-07 amendment); firing history is `GET /api/triggers/:id/fires`.
 */

import type { DatasetOverride } from "../defineDatasetFromTable";

export const AUDIT_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  suite_runs: {
    name: "test_suite_runs",
    description: "Test suite execution results with completion and pass counts",
    grain: "one row per (ScenarioSetId, BatchRunId)",
    timeColumn: "StartedAt",
    dedup: { versionColumn: "UpdatedAt" },
  },
  event_log: {
    name: "legacy_event_log",
    description:
      "Legacy append-only event log, superseded by the canonical fact tables",
    grain: "one row per (AggregateType, AggregateId, IdempotencyKey)",
    timeColumn: "EventOccurredAt",
    dedup: { versionColumn: "EventTimestamp" },
  },
};
