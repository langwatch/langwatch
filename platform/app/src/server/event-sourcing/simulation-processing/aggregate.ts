import { defineAggregate } from "@langwatch/event-sourcing";
import {
  cancelRequestedDataSchema,
  initSimulationRunState,
  isTerminalStatus,
  messageSnapshotDataSchema,
  metricsRecordedDataSchema,
  runDeletedDataSchema,
  runFinishedDataSchema,
  runQueuedDataSchema,
  runStartedDataSchema,
  type SimulationMessageRow,
  type SimulationRunState,
  simulationRunStateSchema,
  textMessageEndDataSchema,
  textMessageStartDataSchema,
} from "./schema";

/**
 * The `simulation_run` aggregate (ADR-105).
 *
 * One declaration: the state, the events that mutate it, and the commands
 * that decide which events to try. Everything nameable — the event type
 * strings, the union, the typed creators, the `apply` dispatcher — is
 * derived; there is no `schemas/constants.ts`, no `typeGuards.ts`, no
 * `z.infer` alias file, matching ADR-105's "everything nameable is derived."
 *
 * Every handler is order-invariant (ADR-098 decision 4): each one decides on
 * what the event carries rather than on when it arrived, so the fold reaches
 * the same state regardless of delivery order and never needs to replay
 * `event_log` to recover from a backdated event. That property is what the
 * three defects below actually rest on — see each handler's own comment for
 * how.
 */

// ---------------------------------------------------------------------------
// Message-size guard
//
// A carry-over of the old fold's `capOversizedString`: an upstream SDK that
// ships inline binary media (voice runs persisting base64 PCM16 audio, for
// instance) must not be allowed to write a 90+ MB row. Capping here keeps the
// bound in the one place every message-bearing handler goes through.
// ---------------------------------------------------------------------------

const MAX_MESSAGE_FIELD_BYTES = 64 * 1024;

function capOversizedString(value: string, maxBytes: number): string {
  // The cheap length*3 upper bound on UTF-8 byte length avoids computing
  // Buffer.byteLength for the overwhelming majority of ordinary messages.
  if (value.length * 3 <= maxBytes) return value;
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength <= maxBytes) return value;
  return `[truncated: ${byteLength} bytes (cap ${maxBytes}); likely inline media that was not externalised to stored-objects]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildMessageRestJson(fields: Record<string, unknown>): string {
  const { id: _id, role: _role, content, trace_id: _traceId, ...rest } = fields;
  const out: Record<string, unknown> = { ...rest };
  if (Array.isArray(content)) out.content = content;
  return Object.keys(out).length > 0 ? JSON.stringify(out) : "";
}

function messageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return JSON.stringify(content);
  return "";
}

// ---------------------------------------------------------------------------
// Defect #1 — a cancelled run must never be resurrected as SUCCESS
// ---------------------------------------------------------------------------

/**
 * Ranks a terminal status by how much authority it carries when more than
 * one terminal declaration reaches the same run (ADR-098 decision 4: "status
 * = max(current, incoming) over a declared lattice").
 *
 * `CANCELLED` (2) outranks every observed outcome: it is a statement of
 * intent, not an observation, so a worker's own outcome reported a moment
 * later describes work the user already disowned. `SUCCESS`/`FAILURE`/
 * `ERROR` (1) rank equal to each other — the first to land owns the record.
 * `STALLED` (0) is the liveness process's provisional guess that a quiet run
 * died; a genuine outcome always supersedes it. Anything else (-1) is not a
 * terminal status at all, so it never wins a comparison against one.
 */
function terminalRank(status: string): number {
  if (status === "CANCELLED") return 2;
  if (status === "STALLED") return 0;
  return isTerminalStatus(status) ? 1 : -1;
}

/**
 * Whether an incoming terminal declaration may take over the record of a run
 * that already has one, comparing `(generation, rank)` rather than rank
 * alone (ADR-098 decision 4, ADR-103 decision 6).
 *
 * Rank alone only covers one execution of a run: it carries no generation, so
 * it cannot tell a late event belonging to a cancelled attempt from one
 * belonging to a fresh rerun of the same aggregate id. Comparing generation
 * first closes that gap structurally — a higher generation always wins
 * regardless of rank, and only equal-generation events fall through to the
 * rank ladder. `generation` is 0 for every run today (see `schema.ts`), so
 * this degenerates to the old rank-only comparison until something bumps it;
 * the shape is already correct for the day something does.
 *
 * Strictly-greater, so an equal-authority declaration is a no-op: the first
 * terminal declaration keeps the run.
 */
export function outranksStoredTerminal(
  stored: { generation: number; status: string },
  incoming: { generation: number; status: string },
): boolean {
  if (incoming.generation !== stored.generation) {
    return incoming.generation > stored.generation;
  }
  return terminalRank(incoming.status) > terminalRank(stored.status);
}

/**
 * Guards a non-terminal `status` write once the run already has a
 * `finishedAt`. Every handler that can advance `status` toward a
 * non-terminal value goes through this, which is what stops a late `queued`
 * or `started` from resurrecting a run that has already settled — including
 * a cancelled one, since `finishedAt` is set the moment `CANCELLED` is
 * recorded (see `finished` below; a cancel is recorded as a terminal
 * `finished` event carrying `status: "CANCELLED"`, not as a distinct status
 * transition of its own).
 */
function statusAfter(
  state: SimulationRunState,
  candidate: SimulationRunState["status"],
): SimulationRunState["status"] {
  return state.finishedAt != null ? state.status : candidate;
}

// ---------------------------------------------------------------------------
// The aggregate
// ---------------------------------------------------------------------------

export const simulationRun = defineAggregate("simulation_run")
  .state(simulationRunStateSchema, initSimulationRunState)
  .events({
    /**
     * The run was scheduled. Every field prefers what is already
     * established: `queued` is the run's earliest event but not reliably its
     * first DELIVERY (it can land behind `started` or a snapshot), and
     * overwriting from it unconditionally would blank a name the run already
     * had and drop `status` back to `QUEUED` on a run that was demonstrably
     * running. This is what lets the fold stay order-invariant for this
     * field without needing delivery order as a guarantee (ADR-098 decision
     * 4).
     */
    queued: {
      data: runQueuedDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState => ({
        ...state,
        scenarioId: state.scenarioId || data.scenarioId,
        batchRunId: state.batchRunId || data.batchRunId,
        scenarioSetId: state.scenarioSetId || data.scenarioSetId,
        // Keep whichever value is known: a redelivered `queued` without the
        // field must not erase a denominator an earlier one established.
        batchTotal: data.batchTotal ?? state.batchTotal,
        name: state.name ?? data.name ?? null,
        // Only ever advances a run that has not left PENDING, in addition to
        // the finished-run guard `statusAfter` applies.
        status: statusAfter(
          state,
          state.status === "PENDING" ? "QUEUED" : state.status,
        ),
        description: state.description ?? data.description ?? null,
        metadata:
          state.metadata ??
          (data.metadata ? JSON.stringify(data.metadata) : null),
        queuedAt:
          state.queuedAt != null
            ? Math.min(state.queuedAt, data.occurredAt)
            : data.occurredAt,
      }),
    },

    started: {
      data: runStartedDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState => ({
        ...state,
        scenarioId: state.scenarioId || data.scenarioId,
        batchRunId: state.batchRunId || data.batchRunId,
        scenarioSetId: state.scenarioSetId || data.scenarioSetId,
        name: state.name ?? data.name ?? null,
        description: state.description ?? data.description ?? null,
        metadata:
          state.metadata ??
          (data.metadata ? JSON.stringify(data.metadata) : null),
        status: statusAfter(state, "IN_PROGRESS"),
        startedAt: data.occurredAt,
      }),
    },

    messageSnapshot: {
      data: messageSnapshotDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState => {
        // Out-of-order protection: ignore a snapshot older than the latest
        // one already applied — the one guard order-invariance alone does
        // not give this field for free, because a snapshot's own content
        // (not just its presence) can regress.
        if (data.occurredAt <= state.lastSnapshotOccurredAt) return state;

        const messages: SimulationMessageRow[] = data.messages.map((m) => {
          const record = isRecord(m) ? m : {};
          const id = typeof record.id === "string" ? record.id : "";
          const role = typeof record.role === "string" ? record.role : "";
          return {
            id,
            role,
            content: capOversizedString(
              messageContent(record.content),
              MAX_MESSAGE_FIELD_BYTES,
            ),
            traceId: typeof record.trace_id === "string" ? record.trace_id : "",
            rest: capOversizedString(
              buildMessageRestJson(record),
              MAX_MESSAGE_FIELD_BYTES,
            ),
          };
        });

        return {
          ...state,
          startedAt: state.startedAt ?? data.occurredAt,
          lastSnapshotOccurredAt: data.occurredAt,
          messages,
          traceIds: data.traceIds,
          status: statusAfter(
            state,
            (data.status as SimulationRunState["status"] | undefined) ??
              state.status,
          ),
        };
      },
    },

    textMessageStart: {
      data: textMessageStartDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState => {
        // Idempotent: a message once started is not started again.
        if (state.messages.some((m) => m.id === data.messageId)) return state;

        const row: SimulationMessageRow = {
          id: data.messageId,
          role: data.role,
          content: "",
          traceId: "",
          rest: "",
        };
        const messages = [...state.messages];
        if (data.messageIndex != null) {
          while (messages.length < data.messageIndex) {
            messages.push({
              id: "",
              role: "",
              content: "",
              traceId: "",
              rest: "",
            });
          }
          messages.splice(data.messageIndex, 0, row);
        } else {
          messages.push(row);
        }

        return {
          ...state,
          status: statusAfter(
            state,
            state.status === "PENDING" ? "IN_PROGRESS" : state.status,
          ),
          startedAt: state.startedAt ?? data.occurredAt,
          messages,
        };
      },
    },

    textMessageEnd: {
      data: textMessageEndDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState => {
        const row: SimulationMessageRow = {
          id: data.messageId,
          role: data.role,
          content: capOversizedString(data.content, MAX_MESSAGE_FIELD_BYTES),
          traceId: data.traceId ?? "",
          rest: capOversizedString(
            buildMessageRestJson(
              (data.message ?? {}) as Record<string, unknown>,
            ),
            MAX_MESSAGE_FIELD_BYTES,
          ),
        };

        const existingIndex = state.messages.findIndex(
          (m) => m.id === data.messageId,
        );
        let messages: SimulationMessageRow[];
        if (existingIndex >= 0) {
          messages = state.messages.map((m, i) =>
            i === existingIndex ? row : m,
          );
        } else if (data.messageIndex != null) {
          messages = [...state.messages];
          while (messages.length < data.messageIndex) {
            messages.push({
              id: "",
              role: "",
              content: "",
              traceId: "",
              rest: "",
            });
          }
          if (messages.length === data.messageIndex) {
            messages.push(row);
          } else {
            messages[data.messageIndex] = row;
          }
        } else {
          messages = [...state.messages, row];
        }

        const traceIds =
          data.traceId && !state.traceIds.includes(data.traceId)
            ? [...state.traceIds, data.traceId]
            : state.traceIds;

        return {
          ...state,
          startedAt: state.startedAt ?? data.occurredAt,
          messages,
          traceIds,
        };
      },
    },

    /**
     * The run reported a terminal outcome. A run finishes once: the first
     * `finished` owns the record unless the incoming one OUTRANKS the
     * stored one ({@link outranksStoredTerminal}) — which is the entire
     * mechanism behind defect #1. A cancel (rank 2) can never be displaced
     * by a late success or failure (rank 1) in either arrival order:
     *
     *   cancel first, success second  -> success rank(1) does not outrank
     *                                    stored cancel rank(2) -> no-op,
     *                                    stays CANCELLED.
     *   success first, cancel second  -> cancel rank(2) outranks stored
     *                                    success rank(1) -> takes over,
     *                                    becomes CANCELLED.
     *
     * Both arrival orders converge on CANCELLED. Nothing here ever compares
     * "cancelled" as a separate boolean flag layered on top of `status` —
     * cancellation IS a terminal status value on this same lattice, so the
     * single rank ladder is the whole guard, with no second code path that
     * could disagree with it.
     */
    finished: {
      data: runFinishedDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState => {
        const verdict = data.results?.verdict ?? null;

        let status: SimulationRunState["status"];
        const explicit = data.status?.toUpperCase();
        if (explicit && isTerminalStatus(explicit)) {
          status = explicit;
        } else if (verdict === "success") {
          status = "SUCCESS";
        } else {
          // "failure" | "inconclusive" | no verdict at all.
          status = "FAILURE";
        }

        if (
          state.finishedAt != null &&
          !outranksStoredTerminal(
            { generation: state.generation, status: state.status },
            { generation: state.generation, status },
          )
        ) {
          return state;
        }

        return {
          ...state,
          status,
          verdict,
          reasoning: data.results?.reasoning ?? null,
          metCriteria: data.results?.metCriteria ?? [],
          unmetCriteria: data.results?.unmetCriteria ?? [],
          error: data.results?.error ?? null,
          durationMs: data.durationMs ?? null,
          finishedAt: data.occurredAt,
        };
      },
    },

    /**
     * The run was measured. The event carries the whole answer — every trace
     * aggregated — so this assigns rather than accumulates. There is no
     * per-trace map to re-aggregate from, which is the entire fix for the
     * metrics that used to read wrong: a first measurement taken before cost
     * enrichment finished can no longer freeze a zero forever, because a
     * later, better measurement simply replaces it.
     */
    metricsRecorded: {
      data: metricsRecordedDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState => ({
        ...state,
        totalCost: data.totalCost,
        roleCosts: data.roleCosts,
        roleLatencies: data.roleLatencies,
      }),
    },

    /** Idempotent: keeps the first cancellation request's timestamp. */
    cancelRequested: {
      data: cancelRequestedDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState =>
        state.cancellationRequestedAt != null
          ? state
          : { ...state, cancellationRequestedAt: data.occurredAt },
    },

    deleted: {
      data: runDeletedDataSchema,
      apply: (state: SimulationRunState, data): SimulationRunState => ({
        ...state,
        archivedAt: data.occurredAt,
      }),
    },
  })
  .commands({
    queueRun: {
      input: runQueuedDataSchema,
      handle: (_state, input, events) => [events.queued(input)],
    },
    startRun: {
      input: runStartedDataSchema,
      handle: (_state, input, events) => [events.started(input)],
    },
    snapshotMessages: {
      input: messageSnapshotDataSchema,
      handle: (_state, input, events) => [events.messageSnapshot(input)],
    },
    startTextMessage: {
      input: textMessageStartDataSchema,
      handle: (_state, input, events) => [events.textMessageStart(input)],
    },
    endTextMessage: {
      input: textMessageEndDataSchema,
      handle: (_state, input, events) => [events.textMessageEnd(input)],
    },
    finishRun: {
      input: runFinishedDataSchema,
      handle: (_state, input, events) => [events.finished(input)],
    },
    /**
     * The pure half of the old `ComputeRunMetricsCommand`. Deriving the
     * values themselves reads the trace-processing pipeline's own stored
     * spans/summaries — a cross-pipeline read that ADR-098 decision 9 says
     * needs a command bridge, and trace-processing has not converted onto
     * these packages yet (ADR-105's "Known debt", step 3). That bridge is a
     * composition-root concern (ADR-102) outside this pipeline's directory;
     * this command only decides the event once the values are already known.
     */
    recordMetrics: {
      input: metricsRecordedDataSchema,
      handle: (_state, input, events) => [events.metricsRecorded(input)],
    },
    cancelRun: {
      input: cancelRequestedDataSchema,
      handle: (_state, input, events) => [events.cancelRequested(input)],
    },
    deleteRun: {
      input: runDeletedDataSchema,
      handle: (_state, input, events) => [events.deleted(input)],
    },
  })
  .build();

export type SimulationRunAggregate = typeof simulationRun;
