import { isTerminalStatus, type SimulationRunState } from "./schema";

/** Sorted set-union, so no writer's arrival order can show in the array. */
export function unionTraceIds(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  return [...new Set([...existing, ...incoming])].filter(Boolean).sort();
}

/** The earlier of two observations, either of which may be unknown. */
export function earliest(
  existing: number | null,
  incoming: number,
): number {
  return existing === null ? incoming : Math.min(existing, incoming);
}

/**
 * How far through its lifecycle a non-terminal status is. Monotone, so two
 * deliveries advancing the same run converge whichever lands first. Terminal
 * statuses are off this ladder entirely — `finished` owns them.
 */
const LIFECYCLE_RANK: Record<string, number> = {
  PENDING: 0,
  QUEUED: 1,
  IN_PROGRESS: 2,
};

/**
 * The further-along of the run's current status and a candidate. A run that
 * already has a `finishedAt` keeps its terminal status, which is what stops a
 * late `queued` or `started` resurrecting a settled run — a cancel included,
 * since a cancel is recorded as a terminal `finished`.
 */
export function advanceStatus(
  state: SimulationRunState,
  candidate: SimulationRunState["status"] | undefined,
): SimulationRunState["status"] {
  if (state.finishedAt != null) return state.status;
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
 * reported a moment later describes work the user already disowned.
 * `STALLED` is the liveness process's provisional guess and loses to any
 * genuine outcome. A non-terminal status never wins against a terminal one.
 */
function terminalRank(status: string): number {
  if (status === "CANCELLED") return 2;
  if (status === "STALLED") return 0;
  return isTerminalStatus(status) ? 1 : -1;
}

/**
 * Whether an incoming terminal declaration takes over a run that already has
 * one. Strictly-greater, so the first of two equal-authority declarations
 * keeps the run.
 */
export function outranksStoredTerminal(
  stored: string,
  incoming: string,
): boolean {
  return terminalRank(incoming) > terminalRank(stored);
}
