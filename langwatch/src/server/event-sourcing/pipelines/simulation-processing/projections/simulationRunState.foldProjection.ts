import type { Projection } from "../../../library";
import type { FoldProjectionDefinition } from "../../../library/projections/foldProjection.types";
import {
  SIMULATION_PROCESSING_EVENT_TYPES,
  SIMULATION_PROJECTION_VERSIONS,
} from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
import {
  isSimulationRunStartedEvent,
  isSimulationMessageSnapshotEvent,
  isSimulationRunFinishedEvent,
} from "../schemas/events";
import { simulationRunStateFoldStore } from "../repositories/simulationRunStateFoldStore";

/**
 * State data for a simulation run.
 * Matches the simulation_runs ClickHouse table schema.
 *
 * This is both the fold state and the stored data — one type, not two.
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
  Messages: string; // JSON string — latest snapshot overwrites
  TraceIds: string; // JSON array of unique trace IDs for read-time join
  Verdict: string | null;
  Reasoning: string | null;
  MetCriteria: string; // JSON array string
  UnmetCriteria: string; // JSON array string
  Error: string | null;
  DurationMs: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  FinishedAt: number | null;
}

export interface SimulationRunState extends Projection<SimulationRunStateData> {
  data: SimulationRunStateData;
}

/**
 * FoldProjection definition for simulation run state.
 *
 * Events are applied in order:
 * - SimulationRunStartedEvent -> status: "IN_PROGRESS"
 * - SimulationMessageSnapshotEvent -> messages overwritten with latest snapshot
 * - SimulationRunFinishedEvent -> final status + results
 */
export const simulationRunStateFoldProjection: FoldProjectionDefinition<
  SimulationRunStateData,
  SimulationProcessingEvent
> = {
  name: "simulationRunState",
  version: SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
  eventTypes: SIMULATION_PROCESSING_EVENT_TYPES,

  init(): SimulationRunStateData {
    return {
      ScenarioRunId: "",
      ScenarioId: "",
      BatchRunId: "",
      ScenarioSetId: "default",
      Status: "IN_PROGRESS",
      Name: null,
      Description: null,
      Messages: "[]",
      TraceIds: "[]",
      Verdict: null,
      Reasoning: null,
      MetCriteria: "[]",
      UnmetCriteria: "[]",
      Error: null,
      DurationMs: null,
      CreatedAt: 0,
      UpdatedAt: 0,
      FinishedAt: null,
    };
  },

  apply(
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
        Name: event.data.metadata?.name ?? null,
        Description: event.data.metadata?.description ?? null,
        CreatedAt: event.timestamp,
        UpdatedAt: event.timestamp,
      };
    }

    if (isSimulationMessageSnapshotEvent(event)) {
      const traceIds = event.data.messages
        .map((m) => m.trace_id)
        .filter((id): id is string => !!id);
      const uniqueTraceIds = [...new Set(traceIds)];

      return {
        ...state,
        Messages: JSON.stringify(event.data.messages),
        TraceIds: JSON.stringify(uniqueTraceIds),
        UpdatedAt: event.timestamp,
      };
    }

    if (isSimulationRunFinishedEvent(event)) {
      return {
        ...state,
        Status: event.data.status,
        Verdict: event.data.results?.verdict ?? null,
        Reasoning: event.data.results?.reasoning ?? null,
        MetCriteria: JSON.stringify(event.data.results?.metCriteria ?? []),
        UnmetCriteria: JSON.stringify(event.data.results?.unmetCriteria ?? []),
        Error: event.data.results?.error ?? null,
        DurationMs: state.CreatedAt ? event.timestamp - state.CreatedAt : null,
        FinishedAt: event.timestamp,
        UpdatedAt: event.timestamp,
      };
    }

    return state;
  },

  store: simulationRunStateFoldStore,
};
