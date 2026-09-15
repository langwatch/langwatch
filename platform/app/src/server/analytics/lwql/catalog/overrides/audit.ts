/**
 * Overrides for audit and test suite datasets.
 *
 * Automation audit tracks trigger executions and actions. Suite runs track test
 * execution results. Both are operational metadata with no content or cost gating.
 */

import type { Partial } from "lodash";
import type { DatasetOverride } from "../defineDatasetFromTable";

export const AUDIT_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  automation_audit: {
    description: "Audit log of automation trigger executions and actions",
    grain: "one row per EventId",
    timeColumn: "OccurredAt",
  },
  suite_runs: {
    description: "Test suite execution results with completion and pass counts",
    grain: "one row per (ScenarioSetId, BatchRunId)",
    timeColumn: "StartedAt",
  },
};
