/**
 * Overrides for audit and test suite views.
 *
 * Automation audit tracks trigger executions and actions. Suite runs track test
 * execution results. Both are operational metadata with no content or cost gating.
 */

import type { DatasetOverride } from "../defineDatasetFromTable";

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
    description:
      "Legacy append-only event log, superseded by the canonical fact tables",
    grain: "one row per (AggregateType, AggregateId, IdempotencyKey)",
    timeColumn: "EventOccurredAt",
    dedup: { versionColumn: "EventTimestamp" },
  },
};
