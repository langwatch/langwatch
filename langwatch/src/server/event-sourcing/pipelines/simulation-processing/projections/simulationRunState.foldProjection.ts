import { isRecord } from "~/server/app-layer/traces/canonicalisation/extractors/_guards";
import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { SIMULATION_PROJECTION_VERSIONS } from "../schemas/constants";
import type {
  SimulationRunQueuedEvent,
  SimulationRunStartedEvent,
  SimulationMessageSnapshotEvent,
  SimulationTextMessageStartEvent,
  SimulationTextMessageEndEvent,
  SimulationRunFinishedEvent,
  SimulationRunMetricsComputedEvent,
  SimulationRunCancelRequestedEvent,
  SimulationRunDeletedEvent,
} from "../schemas/events";
import {
  SimulationRunQueuedEventSchema,
  SimulationRunStartedEventSchema,
  SimulationMessageSnapshotEventSchema,
  SimulationTextMessageStartEventSchema,
  SimulationTextMessageEndEventSchema,
  SimulationRunFinishedEventSchema,
  SimulationRunMetricsComputedEventSchema,
  SimulationRunCancelRequestedEventSchema,
  SimulationRunDeletedEventSchema,
} from "../schemas/events";
import { ValidationError } from "~/server/event-sourcing/services/errorHandling";
import { createLogger } from "~/utils/logger/server";

const projectionLogger = createLogger("simulationRunState.foldProjection");

/**
 * Per-message size cap for `Messages.Content` / `Messages.Rest`.
 *
 * Set generously (64 KiB) so normal text turns — even verbose multi-paragraph
 * assistant replies — are never truncated. Messages that exceed this are
 * almost always the symptom of an upstream SDK shipping inline binary media
 * that the stored-objects pipeline failed to externalise (the original
 * symptom: scenario voice runs persisting full base64 PCM16 audio in
 * `Messages.Content`, which then leaked into every `getSuiteRunData`
 * response). Truncation here keeps the list path bounded and makes the
 * regression visible (via logs + the surfaced marker) instead of silently
 * blowing up the simulations page.
 */
const MAX_MESSAGE_CONTENT_BYTES = 64 * 1024;
const MAX_MESSAGE_REST_BYTES = 64 * 1024;

/**
 * Cap an oversized message-content / rest string and emit a structured warn
 * log so an SDK regression doesn't silently land 90+ MB rows in ClickHouse.
 * The returned marker has a stable prefix so monitoring + retroactive scans
 * can find affected rows.
 */
function capOversizedString({
  value,
  maxBytes,
  field,
  ctx,
}: {
  value: string;
  maxBytes: number;
  field: "Content" | "Rest";
  ctx: { scenarioRunId: string; messageId?: string; messageRole?: string };
}): string {
  // String length is char-count (UTF-16 code units); UTF-8 may use up to 3
  // bytes per code unit (4 for surrogate pairs, but a pair occupies two code
  // units so the per-code-unit ceiling is still 3). The only safe length-only
  // short-circuit is the inverse bound: when length*3 <= maxBytes the UTF-8
  // byte length is guaranteed to fit. Using length <= maxBytes as the bypass
  // would let a multibyte string ~3× over the cap slip through.
  if (value.length * 3 <= maxBytes) return value;
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength <= maxBytes) return value;
  projectionLogger.warn(
    {
      scenarioRunId: ctx.scenarioRunId,
      messageId: ctx.messageId,
      messageRole: ctx.messageRole,
      field,
      byteLength,
      maxBytes,
    },
    `simulation message ${field} exceeds size cap — truncating (probable inline media not externalised)`,
  );
  return `[truncated: message ${field.toLowerCase()} was ${byteLength} bytes (cap ${maxBytes}); likely inline media that was not externalised to stored-objects]`;
}

function buildMessageRestJson(messageFields: Record<string, unknown>): string {
  // When `content` is an array, preserve it in Rest so the renderer can route
  // each part through <MediaPart>. Flat-string content goes to the top-level
  // Content column and is omitted here. The AG-UI `parts` field (alternative
  // location for content parts on ChatMessage) is already preserved via the
  // ...restFields spread below; only `content` needs the special-case to
  // bypass the flat-string column.
  const { id, role, content, trace_id, ...restFields } = messageFields;
  const rest: Record<string, unknown> = { ...restFields };
  if (Array.isArray(content)) {
    rest.content = content;
  }
  return Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";
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
 * Handlers do all computation. Store is a dumb read/write layer.
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
  CancellationRequestedAt: number | null;
  LastSnapshotOccurredAt: number;
  LastEventOccurredAt: number;
}

export interface SimulationRunState extends Projection<SimulationRunStateData> {
  data: SimulationRunStateData;
}

/**
 * Guards a non-terminal Status transition once a run is already finished.
 *
 * Orphaned-run reconciliation writes a terminal `finished` event for a run
 * whose worker died. If that worker's child process actually outlived its
 * parent (reparented) and later POSTs a real started/snapshot whose
 * client-supplied `occurredAt` is AFTER the reconciliation time, the event
 * applies in-order (the executor only re-folds when occurredAt is STRICTLY
 * less than what we've already seen) and would otherwise clobber Status back to
 * a non-terminal value while FinishedAt stays set — an unrecoverable zombie the
 * read-time stall path can no longer rescue (it only resolves runs with no
 * FinishedAt). Once FinishedAt is set, Status stays terminal.
 */
function statusAfter({
  state,
  candidate,
}: {
  state: SimulationRunStateData;
  candidate: string;
}): string {
  return state.FinishedAt != null ? state.Status : candidate;
}

const simulationRunEvents = [
  SimulationRunQueuedEventSchema,
  SimulationRunStartedEventSchema,
  SimulationMessageSnapshotEventSchema,
  SimulationTextMessageStartEventSchema,
  SimulationTextMessageEndEventSchema,
  SimulationRunFinishedEventSchema,
  SimulationRunMetricsComputedEventSchema,
  SimulationRunCancelRequestedEventSchema,
  SimulationRunDeletedEventSchema,
] as const;

/**
 * Type-safe fold projection for simulation run state.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings (e.g. `"lw.simulation_run.queued"` -> `handleSimulationRunQueued`)
 * - `UpdatedAt` is auto-managed by the base class after each handler call
 */
export class SimulationRunStateFoldProjection
  extends AbstractFoldProjection<SimulationRunStateData, typeof simulationRunEvents>
  implements FoldEventHandlers<typeof simulationRunEvents, SimulationRunStateData>
{
  readonly name = "simulationRunState";
  readonly version = SIMULATION_PROJECTION_VERSIONS.RUN_STATE;
  readonly store: FoldProjectionStore<SimulationRunStateData>;

  protected readonly events = simulationRunEvents;

  constructor(deps: { store: FoldProjectionStore<SimulationRunStateData> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
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
      FinishedAt: null,
      ArchivedAt: null,
      CancellationRequestedAt: null,
      LastSnapshotOccurredAt: 0,
    };
  }

  handleSimulationRunQueued(
    event: SimulationRunQueuedEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
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
    };
  }

  handleSimulationRunStarted(
    event: SimulationRunStartedEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      ScenarioId: state.ScenarioId || event.data.scenarioId,
      BatchRunId: state.BatchRunId || event.data.batchRunId,
      ScenarioSetId: state.ScenarioSetId || event.data.scenarioSetId,
      Name: state.Name ?? event.data.name ?? null,
      Description: state.Description ?? event.data.description ?? null,
      Metadata: state.Metadata ?? (event.data.metadata ? JSON.stringify(event.data.metadata) : null),
      Status: statusAfter({ state, candidate: "IN_PROGRESS" }),
      StartedAt: event.occurredAt,
    };
  }

  handleSimulationRunMessageSnapshot(
    event: SimulationMessageSnapshotEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
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

        // Content can be either:
        //   - a string (legacy SDK output, possibly a Python-repr-stringified array)
        //   - an array of rich-content parts (the canonical AG-UI/OpenAI shape,
        //     produced by the stored-objects extractor's rewrite pass)
        //   - null / undefined / something else (we tolerate by storing "")
        // We always serialize to a string for the parallel-array CH column.
        // Array content gets JSON.stringify'd; the renderer's
        // safeJsonParseOrStringFallback in flattenContent parses it back.
        let content = "";
        if (typeof m.content === "string") {
          content = m.content;
        } else if (Array.isArray(m.content)) {
          content = JSON.stringify(m.content);
        }

        const messageId = typeof m.id === "string" ? m.id : "";
        const messageRole = typeof m.role === "string" ? m.role : "";
        // Snapshots can arrive BEFORE the run-started event (see
        // `StartedAt: state.StartedAt ?? event.occurredAt` two lines up); on
        // that path state.ScenarioRunId is still empty while the event already
        // carries the id. Fall back so an oversized first snapshot's warn log
        // is locatable instead of arriving id-less.
        const scenarioRunId = state.ScenarioRunId || event.data.scenarioRunId;
        const ctx = { scenarioRunId, messageId, messageRole };

        return {
          Id: messageId,
          Role: messageRole,
          Content: capOversizedString({
            value: content,
            maxBytes: MAX_MESSAGE_CONTENT_BYTES,
            field: "Content",
            ctx,
          }),
          TraceId: typeof m.trace_id === "string" ? m.trace_id : "",
          Rest: capOversizedString({
            value: buildMessageRestJson(m),
            maxBytes: MAX_MESSAGE_REST_BYTES,
            field: "Rest",
            ctx,
          }),
        };
      }),
      TraceIds: Array.isArray(event.data.traceIds) ? event.data.traceIds : [],
      Status: statusAfter({
        state,
        candidate: event.data.status ?? state.Status,
      }),
    };
  }

  handleSimulationRunTextMessageStart(
    event: SimulationTextMessageStartEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
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
      Status: statusAfter({
        state,
        candidate: state.Status === "PENDING" ? "IN_PROGRESS" : state.Status,
      }),
      StartedAt: state.StartedAt ?? event.occurredAt,
      Messages: messages,
    };
  }

  handleSimulationRunTextMessageEnd(
    event: SimulationTextMessageEndEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
    const existingIndex = state.Messages.findIndex(
      (m) => m.Id === event.data.messageId,
    );

    // TextMessageEnd can also fold before the started event (the handler
    // appends/pads even without a prior START); fall back to the event's
    // scenarioRunId so the warn log carries the run identifier.
    const ctx = {
      scenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      messageId: event.data.messageId,
      messageRole: event.data.role,
    };
    const row: SimulationMessageRow = {
      Id: event.data.messageId,
      Role: event.data.role,
      Content: capOversizedString({
        value: event.data.content,
        maxBytes: MAX_MESSAGE_CONTENT_BYTES,
        field: "Content",
        ctx,
      }),
      TraceId: event.data.traceId ?? "",
      Rest: capOversizedString({
        value: buildMessageRestJson((event.data.message ?? {}) as Record<string, unknown>),
        maxBytes: MAX_MESSAGE_REST_BYTES,
        field: "Rest",
        ctx,
      }),
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
    };
  }

  handleSimulationRunFinished(
    event: SimulationRunFinishedEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
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
    };
  }

  handleSimulationRunMetricsComputed(
    event: SimulationRunMetricsComputedEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
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
    };
  }

  handleSimulationRunCancelRequested(
    _event: SimulationRunCancelRequestedEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
    // Idempotent: keep the original timestamp if already requested
    if (state.CancellationRequestedAt != null) return state;
    return {
      ...state,
      CancellationRequestedAt: _event.occurredAt,
    };
  }

  handleSimulationRunDeleted(
    event: SimulationRunDeletedEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      ArchivedAt: event.occurredAt,
    };
  }
}
