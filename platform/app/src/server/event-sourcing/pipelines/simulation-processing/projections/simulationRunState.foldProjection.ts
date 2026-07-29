import { createLogger } from "@langwatch/observability";
import { isRecord } from "~/server/app-layer/traces/canonicalisation/extractors/_guards";
import { ValidationError } from "~/server/event-sourcing/services/errorHandling";
import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { SIMULATION_PROJECTION_VERSIONS } from "../schemas/constants";
import type {
  SimulationMessageSnapshotEvent,
  SimulationRunCancelRequestedEvent,
  SimulationRunDeletedEvent,
  SimulationRunFinishedEvent,
  SimulationRunMetricsRecordedEvent,
  SimulationRunQueuedEvent,
  SimulationRunStartedEvent,
  SimulationTextMessageEndEvent,
  SimulationTextMessageStartEvent,
} from "../schemas/events";
import {
  SimulationMessageSnapshotEventSchema,
  SimulationRunCancelRequestedEventSchema,
  SimulationRunDeletedEventSchema,
  SimulationRunFinishedEventSchema,
  SimulationRunMetricsRecordedEventSchema,
  SimulationRunQueuedEventSchema,
  SimulationRunStartedEventSchema,
  SimulationTextMessageEndEventSchema,
  SimulationTextMessageStartEventSchema,
} from "../schemas/events";

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
interface SimulationMessageRow {
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
  /**
   * How many runs the dispatching batch intended to queue (ADR-072). Every
   * child of a batch carries the same value, so the batch's denominator is
   * available from whichever row lands first rather than from a separate
   * suite-run record. 0 means unknown — runs queued before this field existed,
   * for which the read path counts rows instead.
   */
  BatchTotal: number;
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
  /**
   * The run's cost and latency, assigned wholesale from a single
   * `metrics_recorded` event (see `handleSimulationRunMetricsRecorded`). There is
   * deliberately no per-trace accumulator behind them: every measurement covers
   * all of the run's traces at once, so a re-measure replaces rather than
   * merges.
   */
  TotalCost: number | null;
  RoleCosts: Record<string, number[]>;
  RoleLatencies: Record<string, number[]>;
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
 * FinishedAt).
 *
 * Once FinishedAt is set, Status stays terminal. Three things hold that line
 * together, and all three are load-bearing:
 *   1. this guard, at EVERY non-terminal Status writer — queued, started,
 *      snapshot, and textMessageStart. Miss one and the invariant is gone: a
 *      `queued` event folded after `finished` used to resurrect Status=QUEUED
 *      with FinishedAt still set. If you add a handler that writes a
 *      non-terminal Status, it goes through here too;
 *   2. `handleSimulationRunFinished` returning early once FinishedAt is set,
 *      unless the incoming finish OUTRANKS the stored one (see
 *      {@link terminalStatusAuthority}) — so a run finishes once, and the only
 *      thing that can revise a finished run is another terminal declaration
 *      with more authority, never a non-terminal one;
 *   3. that same handler refusing a non-terminal explicit status, since the
 *      finished event's `status` is only typed `z.string().optional()` on the
 *      internal event schema — any string can reach the fold.
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

/**
 * The statuses a run may hold once FinishedAt is set. A `finished` event whose
 * explicit status is outside this set is not describing a finished run, so its
 * status is discarded in favour of the verdict-derived one — writing it would
 * strand the run non-terminal but finished, which nothing reconciles.
 */
const TERMINAL_STATUSES = new Set([
  "SUCCESS",
  "FAILURE",
  "FAILED",
  "ERROR",
  "CANCELLED",
  "STALLED",
]);

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * How much authority a terminal status carries when more than one `finished`
 * event reaches the same run.
 *
 * A run finishes once, but three independent writers can each declare it
 * finished — the worker reporting its own outcome, the user's cancel, and the
 * liveness wake that fires when a run goes quiet — and nothing orders them.
 * Ranking them makes the stored record a function of WHAT was declared rather
 * than of which declaration happened to be folded first, which is the property
 * a fold needs: the same event set must produce the same state under a replay
 * in any order.
 *
 * The ranks, and why each status sits where it does:
 *
 * - `CANCELLED` (2) — a statement of intent, not an observation. The user
 *   stopped the run, so the worker's own outcome a moment later describes work
 *   the user already disowned. Nothing outranks it, so a run the user cancelled
 *   can never read back as a success, in either arrival order. This is the
 *   contract in `specs/features/suites/cancel-queued-running-jobs.feature`.
 * - `SUCCESS` / `FAILURE` / `FAILED` / `ERROR` (1) — the run's observed
 *   outcome, the ordinary case. They rank EQUAL to each other on purpose: the
 *   first to land owns the record and a redelivered or late sibling cannot
 *   rewrite what downstream consumers already acted on, nor split the record
 *   into an ERROR status carrying a late SUCCESS verdict.
 * - `STALLED` (0) — provisional. The `scenarioExecution` deadline wake writes
 *   it (ADR-073 step 2) because the run stopped reporting, which is a guess
 *   that the run died. A genuine `finished` arriving afterwards is proof the
 *   guess was wrong — the run was merely slow — so any real outcome supersedes
 *   it. Treating STALLED as immutable, the way CANCELLED is, would freeze every
 *   quiet-but-alive run as STALLED for good.
 * - anything else (-1) — not a terminal status, so it cannot legitimately be
 *   the status of a run whose FinishedAt is set. Ranking it below everything
 *   lets a real terminal finish repair such a row rather than be blocked by it.
 *
 * `DELETED` is deliberately absent: deletion is not a status here.
 * `handleSimulationRunDeleted` sets `ArchivedAt` and leaves `Status` alone, so
 * it never competes for the record.
 *
 * Note this ladder governs terminal-vs-terminal only. Non-terminal writers
 * (queued / started / snapshot / textMessageStart) stay blocked outright by
 * {@link statusAfter} once FinishedAt is set — including on a STALLED run. A
 * late snapshot proving the run is alive would otherwise leave Status
 * non-terminal WITH FinishedAt set, the one state nothing reconciles; only a
 * real terminal `finished` may take a stalled run back.
 */
function terminalStatusAuthority(status: string): number {
  if (status === "CANCELLED") return 2;
  if (status === "STALLED") return 0;
  return isTerminalStatus(status) ? 1 : -1;
}

/**
 * Whether an incoming `finished` event's status may take over the record of a
 * run that is already finished. See {@link terminalStatusAuthority} for why
 * each status ranks where it does.
 *
 * Strictly-greater, so equal authority means the first finish keeps the run
 * and a duplicate is a no-op.
 */
function supersedesFinishedRun({
  stored,
  incoming,
}: {
  stored: string;
  incoming: string;
}): boolean {
  return terminalStatusAuthority(incoming) > terminalStatusAuthority(stored);
}

const simulationRunEvents = [
  SimulationRunQueuedEventSchema,
  SimulationRunStartedEventSchema,
  SimulationMessageSnapshotEventSchema,
  SimulationTextMessageStartEventSchema,
  SimulationTextMessageEndEventSchema,
  SimulationRunFinishedEventSchema,
  SimulationRunMetricsRecordedEventSchema,
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
  extends AbstractFoldProjection<
    SimulationRunStateData,
    typeof simulationRunEvents
  >
  implements
    FoldEventHandlers<typeof simulationRunEvents, SimulationRunStateData>
{
  readonly name = "simulationRunState";
  readonly version = SIMULATION_PROJECTION_VERSIONS.RUN_STATE;
  readonly store: FoldProjectionStore<SimulationRunStateData>;

  /**
   * `refoldOnOutOfOrder: false` — a backdated event is applied on top of the
   * state already stored, never by replaying the run's history from `init()`.
   *
   * **Why it must be off.** A replay derives state from the events the fold
   * still handles, and this fold no longer handles all of the events in its own
   * log. `lw.simulation_run.metrics_computed` is RETIRED
   * (`schemas/constants.ts`): runs measured under it have their cost and
   * per-role latencies in those events and in no other, because the run-level
   * `metrics_recorded` that replaced it is only ever emitted by a deadline armed
   * on a LIVE `finished`. `apply` returns state unchanged for an event it has no
   * handler for, so a replay of such a run rebuilds `TotalCost: null`,
   * `RoleCosts: {}` and `RoleLatencies: {}` and stores that over the correct
   * row. Nothing recovers it — the spans it would be re-derived from are in the
   * `traces` retention category, which expires ahead of `scenarios`.
   *
   * **Why it is safe to turn off.** Every handler decides on what the event
   * carries rather than on when it arrived, so the fold reaches the same state
   * whichever order it sees events in and the replay derives nothing:
   *   - terminal-vs-terminal is settled by {@link terminalStatusAuthority}, so a
   *     cancel outranks a late success in either arrival order;
   *   - every non-terminal status writer goes through {@link statusAfter}, so
   *     nothing reopens a finished run, and each one only advances a run that is
   *     still `PENDING`;
   *   - snapshots are guarded by `LastSnapshotOccurredAt`, messages are keyed by
   *     `messageId`, trace ids are a set, and identity/label fields keep the
   *     value already established;
   *   - `metrics_recorded` assigns the whole measurement from one event, so a
   *     re-measure replaces rather than compounds.
   * `simulationRunState.ordering.unit.test.ts` folds every permutation of a
   * run's lifecycle through a harness that mirrors the executor, and that is
   * what holds this claim honest rather than the paragraph above.
   *
   * The replay was also the amplification the trace folds hit: it reads every
   * event for the aggregate and raises the checkpoint to the highest `occurredAt`
   * seen, so one backdated event makes every later batch look out of order too.
   */
  readonly options = { refoldOnOutOfOrder: false } as const;

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
      BatchTotal: 0,
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
      StartedAt: null,
      QueuedAt: null,
      FinishedAt: null,
      ArchivedAt: null,
      CancellationRequestedAt: null,
      LastSnapshotOccurredAt: 0,
    };
  }

  /**
   * The run was scheduled.
   *
   * Every field prefers what is already established, which is what makes this
   * handler order-insensitive and therefore what lets the fold decline the
   * out-of-order replay (see {@link SimulationRunStateFoldProjection.options}).
   * `queued` is the run's EARLIEST event but not reliably its first DELIVERY:
   * it can land behind `started` or a snapshot, and overwriting from it then
   * blanked a name the run already had and dropped Status back to QUEUED on a
   * run that was demonstrably running.
   *
   * There is at most one `queued` per run — `queueRun`'s idempotency key is
   * `<tenant>:<scenarioRunId>:queueRun` — so preferring the stored value never
   * loses a second, better one.
   */
  handleSimulationRunQueued(
    event: SimulationRunQueuedEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      ScenarioId: state.ScenarioId || event.data.scenarioId,
      BatchRunId: state.BatchRunId || event.data.batchRunId,
      ScenarioSetId: state.ScenarioSetId || event.data.scenarioSetId,
      // Keep whichever value is known: a `queued` event redelivered without
      // the field must not erase a denominator an earlier one established.
      BatchTotal: event.data.batchTotal ?? state.BatchTotal,
      Name: state.Name ?? event.data.name ?? null,
      // Only ever advances a run that has not left PENDING. `statusAfter` alone
      // blocks a resurrection past `finished`; this also blocks the shorter one
      // past `started`, where FinishedAt is still null.
      Status: statusAfter({
        state,
        candidate: state.Status === "PENDING" ? "QUEUED" : state.Status,
      }),
      Description: state.Description ?? event.data.description ?? null,
      Metadata:
        state.Metadata ??
        (event.data.metadata ? JSON.stringify(event.data.metadata) : null),
      // The earliest queue time, not the last one folded.
      QueuedAt:
        state.QueuedAt != null
          ? Math.min(state.QueuedAt, event.occurredAt)
          : event.occurredAt,
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
      Metadata:
        state.Metadata ??
        (event.data.metadata ? JSON.stringify(event.data.metadata) : null),
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
          throw new ValidationError(
            `Simulation ${state.ScenarioRunId} failed with invalid message on index ${i}`,
          );
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
        value: buildMessageRestJson(
          (event.data.message ?? {}) as Record<string, unknown>,
        ),
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

    // Derive status: an explicit TERMINAL status takes priority, otherwise
    // derive from verdict. The explicit status arrives from the scenario-events
    // ingest route, whose schema types it as the full ScenarioRunStatus enum —
    // non-terminal members included. Taking it at face value would write a
    // non-terminal Status alongside FinishedAt below, which is the one state
    // nothing can recover: the orphan reconciler skips it (FinishedAt IS NULL)
    // and read-time stall detection skips it (it only resolves unfinished runs).
    let status: string;
    const explicit = event.data.status?.toUpperCase();
    if (explicit && isTerminalStatus(explicit)) {
      status = explicit;
    } else if (verdict === "success") {
      status = "SUCCESS";
    } else if (verdict === "failure" || verdict === "inconclusive") {
      status = "FAILURE";
    } else {
      status = "FAILURE";
    }

    // A run finishes exactly once, and by default the first `finished` owns the
    // record: a second one — a child that outlived the parent this run's orphan
    // reconciliation already failed — must not rewrite what downstream
    // consumers acted on, nor split it (an ERROR Status carrying the late
    // child's SUCCESS Verdict).
    //
    // The exception is a finish that outranks the stored one
    // ({@link supersedesFinishedRun}): a user's cancel always wins, and a real
    // outcome always beats the deadline wake's provisional STALLED. Deciding on
    // authority rather than on arrival means both hold under a replay in either
    // order, and the winner owns the WHOLE outcome — Verdict, Reasoning,
    // criteria, Error, DurationMs, FinishedAt — so the record describes one
    // declaration rather than a blend of two.
    if (
      state.FinishedAt != null &&
      !supersedesFinishedRun({ stored: state.Status, incoming: status })
    ) {
      return state;
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

  /**
   * The run was measured. The event carries the whole answer — every trace
   * aggregated — so this assigns rather than accumulates.
   *
   * That is the entire fix for the metrics that used to be wrong on screen. The
   * predecessor folded one event per trace and kept a `traceId -> metrics` map on
   * the run to re-aggregate from, which made the fold state grow with trace
   * count and, worse, made the answer a function of which per-trace events
   * happened to land: a first one emitted before cost enrichment finished was
   * kept by the event store's idempotency rule and no correction could ever
   * replace it. Assigning from one event means a re-measure simply wins.
   *
   * A re-measure has to be asked for, and this fold is not what asks: the
   * `runMetrics` process manager re-arms while a run's measurement keeps coming
   * back empty, along a short finite ladder
   * (`process-manager/runMetricsProcess.types.ts`). What is guaranteed here is
   * only that a correction is free to land when it does — the fold takes the
   * newest answer whole, with nothing of the previous one surviving underneath.
   */
  handleSimulationRunMetricsRecorded(
    event: SimulationRunMetricsRecordedEvent,
    state: SimulationRunStateData,
  ): SimulationRunStateData {
    return {
      ...state,
      ScenarioRunId: state.ScenarioRunId || event.data.scenarioRunId,
      TotalCost: event.data.totalCost,
      RoleCosts: event.data.roleCosts,
      RoleLatencies: event.data.roleLatencies,
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
