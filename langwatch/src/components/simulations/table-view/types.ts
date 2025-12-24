import type { ScenarioRunData, ScenarioTrace } from "~/app/api/scenario-events/[[...route]]/types";

/**
 * Row data structure for the scenarios table view
 * Represents a single scenario run with all its associated data
 */
export interface ScenarioRunRow extends ScenarioRunData {
  // Traces (for expandable rows)
  metadata: {
    traces: ScenarioTrace[];
  };
}
