import type { SimulationRunStateData } from "../../eventing/simulation-run-state.projection.ts";

/** A settled, passing run fold; a test overrides only the columns it is about. */
export function simulationRunState(
  overrides: Partial<SimulationRunStateData> & { ScenarioRunId: string },
): SimulationRunStateData {
  return {
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Refund flow",
    Description: null,
    Metadata: null,
    Messages: [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "all criteria met",
    MetCriteria: ["greets the user"],
    UnmetCriteria: [],
    InconclusiveCriteria: [],
    Criteria: [],
    Error: null,
    Evaluations: [],
    DurationMs: 1500,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: 1_000,
    QueuedAt: null,
    CreatedAt: 1_000,
    UpdatedAt: 2_000,
    FinishedAt: 2_000,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: 0,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}
