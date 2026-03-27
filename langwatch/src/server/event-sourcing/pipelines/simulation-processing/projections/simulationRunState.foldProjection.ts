import { isRecord } from "~/server/app-layer/traces/canonicalisation/extractors/_guards";
import type { Projection } from "../../../";
import type {
  FoldProjectionDefinition,
  FoldProjectionStore,
} from "../../../projections/foldProjection.types";
import {
  SIMULATION_PROCESSING_EVENT_TYPES,
  SIMULATION_PROJECTION_VERSIONS,
} from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
import {
  isSimulationMessageSnapshotEvent,
  isSimulationRunDeletedEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunMetricsComputedEvent,
  isSimulationRunQueuedEvent,
  isSimulationRunStartedEvent,
  isSimulationTextMessageEndEvent,
  isSimulationTextMessageStartEvent,
} from "../schemas/typeGuards";
import { ValidationError } from "~/server/event-sourcing/services/errorHandling";

function buildMessageRestJson(messageFields: Record<string, unknown>): string {
  const { id, role, content, trace_id, ...restFields } = messageFields;
  return Object.keys(restFields).length > 0 ? JSON.stringify(restFields) : "";
}

/**
 * A single message row stored in the Messages parallel arrays.
 * Maps to `Messages.*` Nested columns in ClickHouse.
 */
export interface SimulationMessageRow {
  Id: string; // opaque message ID, empty string if absent
  Role: string; // "user" | "assistant" | "system" | "tool"
  Content: string; // message content, empty string if null
  TraceId: string; // span trace ID for correlation, empty string if absent
  Rest: string; // JSON of any remaining AG-UI message fields, or ""
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
  Metadata: string | null;
  Messages: SimulationMessageRow[];
  TraceIds: string[];
  Verdict: string | null;
  Reasoning: string | null;
  MetCriteria: string[];
  UnmetCriteria: string[];
  Error: string | null;
  DurationMs: number | null;
  TotalCost: number | null;
  RoleCosts: Record<string, number[]>;
  RoleLatencies: Record<string, number[]>;
  TraceMetrics: Record<string, { totalCost: number; roleCosts: Record<string, number>; roleLatencies: Record<string, number> }>;
  StartedAt: number | null;
  QueuedAt: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  FinishedAt: number | null;
  ArchivedAt: number | null;
  LastSnapshotOccurredAt: number;
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
    Metadata: null,
    Messages: [],
    TraceIds: [],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: null,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: null,
    QueuedAt: null,
    CreatedAt: Date.now(),
    UpdatedAt: Date.now(),
    FinishedAt: null,
    ArchivedAt: null,
    LastSnapshotOccurredAt: 0,
  };
}

function apply(
  state: SimulationRunStateData,
  event: SimulationProcessingEvent,
): SimulationRunStateData {
  if (isSimulationRunQueuedEvent(event)) {
    return {
      ...state,
      ScenarioRunId: event.data.scenarioRunId,
      ScenarioId: event.data.scenarioId,
      BatchRunId: event.data.batchRunId,
      ScenarioSetId: event.data.scenarioSetId,
      Name: event.data.name ?? null,
      Status: "QUEUED",
      Description: event.data.description ?? null,
      Metadata: event.data.metadata ? JSON.stringify(event.data.metadata) : null,
      QueuedAt: event.occurredAt,
      UpdatedAt: event.occurredAt,
    };
  }

  if (isSimulationRunStartedEvent(event)) {
    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      ScenarioId: state.ScenarioId || event.data.scenarioId,
      BatchRunId: state.BatchRunId || event.data.batchRunId,
      ScenarioSetId: state.ScenarioSetId || event.data.scenarioSetId,
      Name: state.Name ?? event.data.name ?? null,
      Description: state.Description ?? event.data.description ?? null,
      Metadata: state.Metadata ?? (event.data.metadata ? JSON.stringify(event.data.metadata) : null),
      Status: "IN_PROGRESS",
      StartedAt: event.occurredAt,
      UpdatedAt: event.occurredAt,
    };
  }

  if (isSimulationMessageSnapshotEvent(event)) {
    // Out-of-order protection: ignore snapshots older than the latest applied
    if (event.occurredAt <= state.LastSnapshotOccurredAt) return state;

    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      // Default StartedAt from event.occurredAt if snapshot arrives before started event
      StartedAt: state.StartedAt ?? event.occurredAt,
      LastSnapshotOccurredAt: event.occurredAt,
      Messages: event.data.messages.map((m, i) => {
        if (!isRecord(m)) {
          throw new ValidationError(`Simulation ${state.ScenarioRunId} failed with invalid message on index ${i}`);
        }

        return {
          Id: typeof m.id === "string" ? m.id : "",
          Role: typeof m.role === "string" ? m.role : "",
          Content: typeof m.content === "string" ? m.content : "",
          TraceId: typeof m.trace_id === "string" ? m.trace_id : "",
          Rest: buildMessageRestJson(m),
        };
      }),
      TraceIds: Array.isArray(event.data.traceIds) ? event.data.traceIds : [],
      Status: event.data.status ?? state.Status,
      UpdatedAt: event.occurredAt,
    };
  }

  if (isSimulationTextMessageStartEvent(event)) {
    // Idempotency: skip if message already exists
    if (state.Messages.some((m) => m.Id === event.data.messageId)) return state;

    const newRow: SimulationMessageRow = {
      Id: event.data.messageId,
      Role: event.data.role,
      Content: "",
      TraceId: "",
      Rest: "",
    };

    const messages = [...state.Messages];
    const idx = event.data.messageIndex;

    if (idx != null) {
      // Pad with placeholder rows if needed
      while (messages.length < idx) {
        messages.push({ Id: "", Role: "", Content: "", TraceId: "", Rest: "" });
      }
      messages.splice(idx, 0, newRow);
    } else {
      messages.push(newRow);
    }

    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      Status: state.Status === "PENDING" ? "IN_PROGRESS" : state.Status,
      StartedAt: state.StartedAt ?? event.occurredAt,
      Messages: messages,
      UpdatedAt: event.occurredAt,
    };
  }

  if (isSimulationTextMessageEndEvent(event)) {
    const existingIndex = state.Messages.findIndex(
      (m) => m.Id === event.data.messageId,
    );

    const row: SimulationMessageRow = {
      Id: event.data.messageId,
      Role: event.data.role,
      Content: event.data.content,
      TraceId: event.data.traceId ?? "",
      Rest: buildMessageRestJson((event.data.message ?? {}) as Record<string, unknown>),
    };

    let updatedMessages: SimulationMessageRow[];
    if (existingIndex >= 0) {
      updatedMessages = state.Messages.map((m, i) =>
        i === existingIndex ? row : m,
      );
    } else if (event.data.messageIndex != null) {
      updatedMessages = [...state.Messages];
      while (updatedMessages.length < event.data.messageIndex) {
        updatedMessages.push({
          Id: "",
          Role: "",
          Content: "",
          TraceId: "",
          Rest: "",
        });
      }
      if (updatedMessages.length === event.data.messageIndex) {
        updatedMessages.push(row);
      } else {
        updatedMessages[event.data.messageIndex] = row;
      }
    } else {
      updatedMessages = [...state.Messages, row];
    }

    // Accumulate traceId if present and not duplicate
    const traceIds =
      event.data.traceId && !state.TraceIds.includes(event.data.traceId)
        ? [...state.TraceIds, event.data.traceId]
        : state.TraceIds;

    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      StartedAt: state.StartedAt ?? event.occurredAt,
      Messages: updatedMessages,
      TraceIds: traceIds,
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

  if (isSimulationRunMetricsComputedEvent(event)) {
    // Store per-trace breakdown, then recompute aggregates
    const traceMetrics = {
      ...state.TraceMetrics,
      [event.data.traceId]: {
        totalCost: event.data.totalCost,
        roleCosts: event.data.roleCosts,
        roleLatencies: event.data.roleLatencies,
      },
    };

    // Aggregate across all traces: collect individual values into arrays
    let totalCost = 0;
    const roleCosts: Record<string, number[]> = {};
    const roleLatencies: Record<string, number[]> = {};

    for (const entry of Object.values(traceMetrics)) {
      totalCost += entry.totalCost;
      for (const [role, cost] of Object.entries(entry.roleCosts)) {
        (roleCosts[role] ??= []).push(cost);
      }
      for (const [role, latency] of Object.entries(entry.roleLatencies)) {
        (roleLatencies[role] ??= []).push(latency);
      }
    }

    return {
      ...state,
      TraceMetrics: traceMetrics,
      TotalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
      RoleCosts: roleCosts,
      RoleLatencies: roleLatencies,
      // Use state.UpdatedAt + 1 instead of event.occurredAt.
      // metrics_computed events are generated server-side (ECST reactor,
      // 60s delay) with occurredAt = Date.now(), which is much higher than
      // the user-sent finished event's occurredAt. In ReplacingMergeTree,
      // the row with highest UpdatedAt wins the merge — if metrics has
      // higher UpdatedAt, it permanently overwrites the finished row.
      // Incrementing from state ensures monotonic ordering without jumping
      // ahead of the finished event's timestamp.
      UpdatedAt: state.UpdatedAt + 1,
    };
  }

  if (isSimulationRunDeletedEvent(event)) {
    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      ArchivedAt: event.occurredAt,
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
}): FoldProjectionDefinition<
  SimulationRunStateData,
  SimulationProcessingEvent
> {
  return {
    name: "simulationRunState",
    version: SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
    eventTypes: SIMULATION_PROCESSING_EVENT_TYPES,
    init,
    apply,
    store: deps.store,
  };
}
