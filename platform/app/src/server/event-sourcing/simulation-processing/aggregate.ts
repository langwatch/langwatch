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
  type SimulationRunState,
  simulationRunStateSchema,
  textMessageEndDataSchema,
  textMessageStartDataSchema,
} from "./schema";
import {
  advanceStatus,
  earliest,
  outranksStoredTerminal,
  unionTraceIds,
} from "./status";

/**
 * The `simulation_run` fold: the run's own identity, lifecycle and outcome.
 * Its messages are item rows (`messages.ts`) and its batch totals a query
 * (`batchAggregates.ts`), so nothing here grows with the work (ADR-103).
 *
 * Every field is commutative and idempotent — set-union, min, max, or a
 * monotone rank — because there is no delivery sequence to fall back on
 * (ADR-098 §5). `aggregate.unit.test.ts` proves it with `checkOrderInvariance`.
 */
export const simulationRun = defineAggregate({
  name: "simulation_run",
  prefix: "lw",
  state: simulationRunStateSchema,
  init: initSimulationRunState,
  id: (data) => data.scenarioRunId,

  events: {
    queued: {
      data: runQueuedDataSchema,
      apply: (state, data) => ({
        ...state,
        scenarioRunId: state.scenarioRunId || data.scenarioRunId,
        scenarioId: state.scenarioId || data.scenarioId,
        batchRunId: state.batchRunId || data.batchRunId,
        scenarioSetId: state.scenarioSetId || data.scenarioSetId,
        // ADR-103 §3's own `max()`: a landed total of 0 never masks the real
        // one a sibling delivery carries.
        batchTotal: Math.max(state.batchTotal, data.batchTotal ?? 0),
        name: state.name ?? data.name ?? null,
        description: state.description ?? data.description ?? null,
        metadata:
          state.metadata ??
          (data.metadata ? JSON.stringify(data.metadata) : null),
        status: advanceStatus(state, "QUEUED"),
        queuedAt: earliest(state.queuedAt, data.occurredAt),
      }),
    },

    started: {
      data: runStartedDataSchema,
      apply: (state, data) => ({
        ...state,
        scenarioRunId: state.scenarioRunId || data.scenarioRunId,
        scenarioId: state.scenarioId || data.scenarioId,
        batchRunId: state.batchRunId || data.batchRunId,
        scenarioSetId: state.scenarioSetId || data.scenarioSetId,
        name: state.name ?? data.name ?? null,
        description: state.description ?? data.description ?? null,
        metadata:
          state.metadata ??
          (data.metadata ? JSON.stringify(data.metadata) : null),
        status: advanceStatus(state, "IN_PROGRESS"),
        startedAt: earliest(state.startedAt, data.occurredAt),
      }),
    },

    /**
     * The messages themselves are the map projection's business; the fold
     * takes only what the snapshot says about the run. A terminal status
     * carried by a snapshot is ignored — `finished` owns terminal state.
     */
    messageSnapshot: {
      data: messageSnapshotDataSchema,
      apply: (state, data) => ({
        ...state,
        scenarioRunId: state.scenarioRunId || data.scenarioRunId,
        startedAt: earliest(state.startedAt, data.occurredAt),
        traceIds: unionTraceIds(state.traceIds, data.traceIds),
        status: advanceStatus(
          state,
          data.status as SimulationRunState["status"] | undefined,
        ),
      }),
    },

    textMessageStart: {
      data: textMessageStartDataSchema,
      apply: (state, data) => ({
        ...state,
        scenarioRunId: state.scenarioRunId || data.scenarioRunId,
        status: advanceStatus(state, "IN_PROGRESS"),
        startedAt: earliest(state.startedAt, data.occurredAt),
      }),
    },

    textMessageEnd: {
      data: textMessageEndDataSchema,
      apply: (state, data) => ({
        ...state,
        scenarioRunId: state.scenarioRunId || data.scenarioRunId,
        startedAt: earliest(state.startedAt, data.occurredAt),
        traceIds: unionTraceIds(
          state.traceIds,
          data.traceId ? [data.traceId] : [],
        ),
      }),
    },

    /**
     * A run finishes once: the first `finished` owns the record unless the
     * incoming one outranks it, which is what makes a cancel survive a late
     * success in either arrival order.
     */
    finished: {
      data: runFinishedDataSchema,
      apply: (state, data) => {
        const verdict = data.results?.verdict ?? null;
        const explicit = data.status?.toUpperCase();

        let status: SimulationRunState["status"];
        if (explicit && isTerminalStatus(explicit)) {
          status = explicit;
        } else if (verdict === "success") {
          status = "SUCCESS";
        } else {
          status = "FAILURE";
        }

        if (
          state.finishedAt != null &&
          !outranksStoredTerminal(state.status, status)
        ) {
          return state;
        }

        return {
          ...state,
          scenarioRunId: state.scenarioRunId || data.scenarioRunId,
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
     * One measurement covers every trace the run produced, so this replaces
     * wholesale rather than accumulating: a figure taken before cost
     * enrichment finished cannot freeze a zero, because a later one supersedes
     * it outright.
     */
    metricsRecorded: {
      data: metricsRecordedDataSchema,
      apply: (state, data) => ({
        ...state,
        scenarioRunId: state.scenarioRunId || data.scenarioRunId,
        totalCost: data.totalCost,
        roleCosts: data.roleCosts,
        roleLatencies: data.roleLatencies,
      }),
    },

    cancelRequested: {
      data: cancelRequestedDataSchema,
      apply: (state, data) => ({
        ...state,
        scenarioRunId: state.scenarioRunId || data.scenarioRunId,
        cancellationRequestedAt: earliest(
          state.cancellationRequestedAt,
          data.occurredAt,
        ),
      }),
    },

    deleted: {
      data: runDeletedDataSchema,
      apply: (state, data) => ({
        ...state,
        scenarioRunId: state.scenarioRunId || data.scenarioRunId,
        archivedAt: earliest(state.archivedAt, data.occurredAt),
      }),
    },
  },

  commands: {
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
     * Deriving the values reads the trace-processing pipeline's stored spans,
     * a cross-pipeline read belonging to a command bridge; this command only
     * decides the event once the values are known.
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
  },
});

export type SimulationRunAggregate = typeof simulationRun;
