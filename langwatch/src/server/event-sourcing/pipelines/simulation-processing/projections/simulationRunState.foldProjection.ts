import type { Projection } from "../../../";
import type { FoldProjectionDefinition, FoldProjectionStore } from "../../../projections/foldProjection.types";
import { SIMULATION_PROCESSING_EVENT_TYPES, SIMULATION_PROJECTION_VERSIONS } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
import {
  isSimulationRunStartedEvent,
  isSimulationMessageSnapshotEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunDeletedEvent,
} from "../schemas/typeGuards";

/**
 * A single message row stored in the Messages parallel arrays.
 * Maps to `Messages.*` Nested columns in ClickHouse.
 */
export interface SimulationMessageRow {
  Id: string;       // opaque message ID, empty string if absent
  Role: string;     // "user" | "assistant" | "system" | "tool"
  Content: string;  // message content, empty string if null
  TraceId: string;  // span trace ID for correlation, empty string if absent
  Rest: string;     // JSON of any remaining AG-UI message fields, or ""
}

/**
 * State data for a simulation run.
 * Matches the simulation_runs ClickHouse table schema.
 *
 * This is both the fold state and the stored data -- one type, not two.
 * `apply()` does all computation. Store is a dumb read/write layer.
 */
export interface SimulationRunStateData {
  ScenarioRunId: string;
  ScenarioId: string;
  BatchRunId: string;
  ScenarioSetId: string;
  Status: string;
  Name: string | null;
  Description: string | null;
  Messages: SimulationMessageRow[];
  TraceIds: string[];
  Verdict: string | null;
  Reasoning: string | null;
  MetCriteria: string[];
  UnmetCriteria: string[];
  Error: string | null;
  DurationMs: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  FinishedAt: number | null;
  DeletedAt: number | null;
}

export interface SimulationRunState extends Projection<SimulationRunStateData> {
  data: SimulationRunStateData;
}

function init(): SimulationRunStateData {
  return {
    ScenarioRunId: "",
    ScenarioId: "",
    BatchRunId: "",
    ScenarioSetId: "",
    Status: "PENDING",
    Name: null,
    Description: null,
    Messages: [],
    TraceIds: [],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: null,
    CreatedAt: 0,
    UpdatedAt: 0,
    FinishedAt: null,
    DeletedAt: null,
  };
}

function apply(
  state: SimulationRunStateData,
  event: SimulationProcessingEvent,
): SimulationRunStateData {
  if (isSimulationRunStartedEvent(event)) {
    return {
      ...state,
      ScenarioRunId: event.data.scenarioRunId,
      ScenarioId: event.data.scenarioId,
      BatchRunId: event.data.batchRunId,
      ScenarioSetId: event.data.scenarioSetId,
      Name: event.data.name ?? null,
      Description: event.data.description ?? null,
      Status: "IN_PROGRESS",
      CreatedAt: event.occurredAt,
      UpdatedAt: event.occurredAt,
    };
  }

  if (isSimulationMessageSnapshotEvent(event)) {
    // Out-of-order protection: ignore snapshots older than current state
    if (event.occurredAt <= state.UpdatedAt) return state;

    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      Messages: event.data.messages.map((m) => {
        const { id, role, content, trace_id, ...restFields } =
          m as Record<string, unknown>;
        const rest =
          Object.keys(restFields).length > 0
            ? JSON.stringify(restFields)
            : "";
        return {
          Id: typeof id === "string" ? id : "",
          Role: typeof role === "string" ? role : "",
          Content: typeof content === "string" ? content : "",
          TraceId: typeof trace_id === "string" ? trace_id : "",
          Rest: rest,
        };
      }),
      TraceIds: Array.isArray(event.data.traceIds) ? event.data.traceIds : [],
      Status: event.data.status ?? state.Status,
      UpdatedAt: event.occurredAt,
    };
  }

  if (isSimulationRunFinishedEvent(event)) {
    const results = event.data.results;
    const verdict = results?.verdict ?? null;

    // Derive status: explicit status takes priority, otherwise derive from verdict
    let status: string;
    if (event.data.status) {
      status = event.data.status.toUpperCase();
    } else if (verdict === "success") {
      status = "SUCCESS";
    } else if (verdict === "failure" || verdict === "inconclusive") {
      status = "FAILURE";
    } else {
      status = "FAILURE";
    }

    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      Status: status,
      Verdict: verdict,
      Reasoning: results?.reasoning ?? null,
      MetCriteria: results?.metCriteria ?? [],
      UnmetCriteria: results?.unmetCriteria ?? [],
      Error: results?.error ?? null,
      DurationMs: event.data.durationMs ?? null,
      FinishedAt: event.occurredAt,
      UpdatedAt: event.occurredAt,
    };
  }

  if (isSimulationRunDeletedEvent(event)) {
    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      DeletedAt: event.occurredAt,
      UpdatedAt: event.occurredAt,
    };
  }

  return state;
}

/**
 * Creates FoldProjection definition for simulation run state.
 *
 * Fold state = stored data. Pure state transitions, no side effects.
 */
export function createSimulationRunStateFoldProjection(deps: {
  store: FoldProjectionStore<SimulationRunStateData>;
}): FoldProjectionDefinition<SimulationRunStateData, SimulationProcessingEvent> {
  return {
    name: "simulationRunState",
    version: SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
    eventTypes: SIMULATION_PROCESSING_EVENT_TYPES,
    init,
    apply,
    store: deps.store,
  };
}
