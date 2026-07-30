import {
  type CancelRequestedData,
  isTerminalStatus,
  type MessageSnapshotData,
  type MetricsRecordedData,
  parseStatus,
  type RunDeletedData,
  type RunFinishedData,
  type RunQueuedData,
  type RunStartedData,
  type SimulationRunState,
  type TextMessageEndData,
  type TextMessageStartData,
} from "./schema";

/** Sorted set-union, so no writer's arrival order can show in the array. */
function unionTraceIds(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  return [...new Set([...existing, ...incoming])].filter(Boolean).sort();
}

/** The earlier of two observations, either of which may be unknown. */
function earliest(existing: number | null, incoming: number): number {
  return existing === null ? incoming : Math.min(existing, incoming);
}

/** The window every event widens, so a redelivery moves neither end. */
function observed(
  state: SimulationRunState,
  occurredAt: number,
): Pick<SimulationRunState, "createdAt" | "lastEventOccurredAt"> {
  return {
    createdAt:
      state.createdAt === 0
        ? occurredAt
        : Math.min(state.createdAt, occurredAt),
    lastEventOccurredAt: Math.max(state.lastEventOccurredAt, occurredAt),
  };
}

/** How far through its lifecycle a non-terminal status is. Terminal statuses
 * are off this ladder entirely — `finished` owns them. */
const LIFECYCLE_RANK: Record<string, number> = {
  PENDING: 0,
  QUEUED: 1,
  IN_PROGRESS: 2,
};

/**
 * The further-along of the run's current status and a candidate. A run that
 * already has a `finishedAt` keeps its terminal status, which is what stops a
 * late `queued` or `started` resurrecting a settled run.
 */
function advanceStatus(
  state: SimulationRunState,
  candidate: SimulationRunState["status"] | undefined,
): SimulationRunState["status"] {
  if (state.finishedAt !== null) return state.status;
  if (candidate === undefined || isTerminalStatus(candidate)) {
    return state.status;
  }
  const current = LIFECYCLE_RANK[state.status] ?? 0;
  const next = LIFECYCLE_RANK[candidate] ?? 0;
  return next > current ? candidate : state.status;
}

/**
 * How much authority a terminal status carries. `CANCELLED` outranks every
 * observed outcome — it is a statement of intent, so a worker's own outcome
 * reported a moment later describes work the user already disowned. `STALLED`
 * is the liveness process's provisional guess and loses to any genuine outcome.
 */
function terminalRank(status: string): number {
  if (status === "CANCELLED") return 2;
  if (status === "STALLED") return 0;
  return isTerminalStatus(status) ? 1 : -1;
}

/** A terminal declaration: what it says, and when it says the run ended. */
export interface TerminalDeclaration {
  readonly status: string;
  readonly at: number;
}

/**
 * Whether an incoming terminal declaration takes over a run that already has
 * one. A total order — authority, then the earlier declaration, then the status
 * itself — so two of equal authority settle the same way whichever arrives
 * first.
 */
export function outranksStoredTerminal(
  stored: TerminalDeclaration,
  incoming: TerminalDeclaration,
): boolean {
  const authority = terminalRank(incoming.status) - terminalRank(stored.status);
  if (authority !== 0) return authority > 0;
  if (incoming.at !== stored.at) return incoming.at < stored.at;
  return incoming.status < stored.status;
}

/**
 * The `simulationRunState` fold's handlers: the run's own identity, lifecycle
 * and outcome. Its messages are item rows (`messages.ts`) and its batch
 * totals a query (`batchAggregates.ts`), so nothing here grows with the work
 * (ADR-103).
 *
 * Every field is a set-union, a min, a max, a monotone rank, or a
 * last-write-wins carrying its own stamp, because there is no delivery
 * sequence to fall back on (ADR-098 §5).
 * `simulationRunState.projection.unit.test.ts` checks that with
 * `checkOrderInvariance`.
 */

/**
 * The sole source of the run's descriptor. `started` carried it too until two
 * carriers disagreeing settled by arrival order.
 */
export function applyQueued(
  state: SimulationRunState,
  data: RunQueuedData,
): SimulationRunState {
  return {
    ...state,
    ...observed(state, data.occurredAt),
    scenarioRunId: state.scenarioRunId || data.scenarioRunId,
    scenarioId: state.scenarioId || data.scenarioId,
    batchRunId: state.batchRunId || data.batchRunId,
    scenarioSetId: state.scenarioSetId || data.scenarioSetId,
    // ADR-103 §3's own `max()`: a landed total of 0 never masks the real one a
    // sibling delivery carries.
    batchTotal: Math.max(state.batchTotal, data.batchTotal ?? 0),
    name: state.name ?? data.name ?? null,
    description: state.description ?? data.description ?? null,
    metadata:
      state.metadata ?? (data.metadata ? JSON.stringify(data.metadata) : null),
    status: advanceStatus(state, "QUEUED"),
    queuedAt: earliest(state.queuedAt, data.occurredAt),
  };
}

export function applyStarted(
  state: SimulationRunState,
  data: RunStartedData,
): SimulationRunState {
  return {
    ...state,
    ...observed(state, data.occurredAt),
    scenarioRunId: state.scenarioRunId || data.scenarioRunId,
    scenarioId: state.scenarioId || data.scenarioId,
    batchRunId: state.batchRunId || data.batchRunId,
    scenarioSetId: state.scenarioSetId || data.scenarioSetId,
    status: advanceStatus(state, "IN_PROGRESS"),
  };
}

/**
 * The messages themselves are the map projection's business; the fold takes
 * only what the snapshot says about the run. A terminal status carried by a
 * snapshot is ignored — `finished` owns terminal state.
 */
export function applyMessageSnapshot(
  state: SimulationRunState,
  data: MessageSnapshotData,
): SimulationRunState {
  return {
    ...state,
    ...observed(state, data.occurredAt),
    scenarioRunId: state.scenarioRunId || data.scenarioRunId,
    traceIds: unionTraceIds(state.traceIds, data.traceIds),
    status: advanceStatus(state, parseStatus(data.status)),
  };
}

export function applyTextMessageStart(
  state: SimulationRunState,
  data: TextMessageStartData,
): SimulationRunState {
  return {
    ...state,
    ...observed(state, data.occurredAt),
    scenarioRunId: state.scenarioRunId || data.scenarioRunId,
    status: advanceStatus(state, "IN_PROGRESS"),
  };
}

export function applyTextMessageEnd(
  state: SimulationRunState,
  data: TextMessageEndData,
): SimulationRunState {
  return {
    ...state,
    ...observed(state, data.occurredAt),
    scenarioRunId: state.scenarioRunId || data.scenarioRunId,
    traceIds: unionTraceIds(state.traceIds, data.traceId ? [data.traceId] : []),
  };
}

/**
 * A run finishes once: the stored declaration owns the record unless the
 * incoming one outranks it, which is what makes a cancel survive a late
 * success in either arrival order.
 */
export function applyFinished(
  state: SimulationRunState,
  data: RunFinishedData,
): SimulationRunState {
  const verdict = data.results?.verdict ?? null;
  const explicit = parseStatus(data.status);

  let status: SimulationRunState["status"];
  if (explicit !== undefined && isTerminalStatus(explicit)) {
    status = explicit;
  } else if (verdict === "success") {
    status = "SUCCESS";
  } else {
    status = "FAILURE";
  }

  const widened = { ...state, ...observed(state, data.occurredAt) };
  if (
    state.finishedAt !== null &&
    !outranksStoredTerminal(
      { status: state.status, at: state.finishedAt },
      { status, at: data.occurredAt },
    )
  ) {
    return widened;
  }

  return {
    ...widened,
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
}

/**
 * One measurement covers every trace the run produced, so this replaces
 * wholesale rather than accumulating. The stamp is what makes that
 * admissible: a figure taken before cost enrichment finished is superseded by
 * a later one, and can never supersede it.
 */
export function applyMetricsRecorded(
  state: SimulationRunState,
  data: MetricsRecordedData,
): SimulationRunState {
  const widened = {
    ...state,
    ...observed(state, data.occurredAt),
    scenarioRunId: state.scenarioRunId || data.scenarioRunId,
  };
  if (state.metricsAsOf !== null && data.occurredAt <= state.metricsAsOf) {
    return widened;
  }
  return {
    ...widened,
    totalCost: data.totalCost,
    roleCosts: data.roleCosts,
    roleLatencies: data.roleLatencies,
    metricsAsOf: data.occurredAt,
  };
}

export function applyCancelRequested(
  state: SimulationRunState,
  data: CancelRequestedData,
): SimulationRunState {
  return {
    ...state,
    ...observed(state, data.occurredAt),
    scenarioRunId: state.scenarioRunId || data.scenarioRunId,
    cancellationRequestedAt: earliest(
      state.cancellationRequestedAt,
      data.occurredAt,
    ),
  };
}

export function applyDeleted(
  state: SimulationRunState,
  data: RunDeletedData,
): SimulationRunState {
  return {
    ...state,
    ...observed(state, data.occurredAt),
    scenarioRunId: state.scenarioRunId || data.scenarioRunId,
    archivedAt: earliest(state.archivedAt, data.occurredAt),
  };
}
