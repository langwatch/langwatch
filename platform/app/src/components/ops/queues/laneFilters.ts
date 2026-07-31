import type { LaneInfo } from "~/server/app-layer/ops/types";

/**
 * What a lane is doing, derived from its own keys.
 *
 * Exactly one status per lane, so the counts beside the filter buttons add up
 * to the listing. The order below is the precedence: a parked lane is reported
 * as parked even if a lease has not expired yet, because parked is the state
 * that needs an operator and a stale lease is not.
 */
export type LaneStatus = "parked" | "leased" | "backoff" | "ready" | "idle";

export type LaneStatusFilter = "all" | LaneStatus;

export const LANE_STATUS_FILTERS: readonly LaneStatusFilter[] = [
  "all",
  "parked",
  "leased",
  "backoff",
  "ready",
  "idle",
];

export const LANE_STATUS_LABELS: Record<LaneStatusFilter, string> = {
  all: "All",
  parked: "Parked",
  leased: "Leased",
  backoff: "Backing off",
  ready: "Ready",
  idle: "Idle",
};

export const LANE_STATUS_COLORS: Record<LaneStatusFilter, string> = {
  all: "gray",
  parked: "red",
  leased: "green",
  backoff: "orange",
  ready: "blue",
  idle: "gray",
};

export function laneStatus(lane: LaneInfo): LaneStatus {
  if (lane.isParked) return "parked";
  if (lane.leaseRemainingMs !== null) return "leased";
  if (lane.readyAtMs !== null) return "backoff";
  return lane.pendingJobs > 0 ? "ready" : "idle";
}

export function countLaneStatuses(
  lanes: LaneInfo[],
): Record<LaneStatusFilter, number> {
  const counts: Record<LaneStatusFilter, number> = {
    all: lanes.length,
    parked: 0,
    leased: 0,
    backoff: 0,
    ready: 0,
    idle: 0,
  };
  for (const lane of lanes) counts[laneStatus(lane)] += 1;
  return counts;
}

/** Matches what the operator can actually see in the row, plus the park reason. */
export function matchesLaneSearch(lane: LaneInfo, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [lane.laneId, lane.laneName, lane.tenantId, lane.parkReason].some(
    (field) => field?.toLowerCase().includes(needle),
  );
}

export function filterLanes(params: {
  lanes: LaneInfo[];
  status: LaneStatusFilter;
  search: string;
}): LaneInfo[] {
  return params.lanes.filter(
    (lane) =>
      (params.status === "all" || laneStatus(lane) === params.status) &&
      matchesLaneSearch(lane, params.search),
  );
}

/**
 * The tenant a tenant-wide drain would target, or null.
 *
 * Deliberately strict: draining a tenant removes every staged job it owns and
 * cannot be undone, so it is offered only when the operator has typed a bare
 * tenant id that some visible lane actually belongs to. A lane-id fragment that
 * merely starts with the tenant is not enough — it reads like a narrower scope
 * than the button would apply.
 */
export function resolveTenantScope(params: {
  lanes: LaneInfo[];
  search: string;
}): string | null {
  const candidate = params.search.trim();
  if (!candidate || /[\s/]/.test(candidate)) return null;
  return params.lanes.some((lane) => lane.tenantId === candidate)
    ? candidate
    : null;
}
