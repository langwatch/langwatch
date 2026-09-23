/** Overrides for audit and test suite views. */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

export const AUDIT_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  automation_audit: {
    name: "automation_events",
    description: "Audit log of automation trigger executions and actions",
    grain: "one row per EventId",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "ProjectedAt" },
  },
  suite_runs: {
    name: "test_suite_runs",
    description: "Test suite execution results with completion and pass counts",
    grain: "one row per (ScenarioSetId, BatchRunId)",
    timeColumn: "StartedAt",
    dedup: { versionColumn: "UpdatedAt" },
  },
  event_log: {
    name: "legacy_event_log",
    description: "Legacy append-only event log, superseded by the canonical fact tables",
    grain: "one row per (AggregateType, AggregateId, IdempotencyKey)",
    timeColumn: "EventOccurredAt",
    dedup: { versionColumn: "EventTimestamp" },
  },
};
