import type { Lane } from "./contracts";

/** One lane, as the scheduler sees it — no I/O, just the facts a caller
 * already knows. `groupKey` is opaque here; it names the lane for the caller
 * that will act on the choice, and the policy never inspects it. */
export interface LaneCandidate {
  readonly tenantId: string;
  readonly lane: Lane;
  readonly groupKey: string;
  readonly leased: boolean;
  readonly parked: boolean;
}

export interface SchedulerConfig {
  /** A tenant at or over this many in-flight lanes is skipped, not idled on.
   * `0` disables the cap for every tenant. */
  readonly tenantSoftCap: number;
  /** The kill-switch predicate (ADR-108 decision 13). Absent means every lane
   * is enabled. */
  readonly enabled?: (lane: Lane) => boolean;
}

export interface SelectLaneInput {
  /** Every currently eligible-looking lane, grouped by tenant only insofar as
   * a tenant's own candidates keep the relative order this array gives them —
   * the policy never reorders within a tenant. */
  readonly candidates: readonly LaneCandidate[];
  readonly tenantInFlight: ReadonlyMap<string, number>;
  /** Which tenant the round-robin starts scanning from this call. Threaded
   * through by the caller so the function stays pure. */
  readonly cursor: number;
  readonly config: SchedulerConfig;
}

export interface SelectLaneResult {
  readonly candidate: LaneCandidate;
  readonly nextCursor: number;
}

/**
 * Which lane next (ADR-108 decision 5): round-robin across tenants, skip a
 * tenant over its soft cap and keep going, skip a leased or parked lane,
 * consult `enabled` before selecting. Decided from counters, not I/O, so it
 * is one pass over `candidates` per call and testable without Redis.
 */
export function selectLane(input: SelectLaneInput): SelectLaneResult | null {
  const { candidates, tenantInFlight, cursor, config } = input;
  const enabled = config.enabled ?? (() => true);

  const tenants: string[] = [];
  for (const candidate of candidates) {
    if (!tenants.includes(candidate.tenantId)) tenants.push(candidate.tenantId);
  }
  if (tenants.length === 0) return null;

  for (let offset = 0; offset < tenants.length; offset++) {
    const tenantIndex = (cursor + offset) % tenants.length;
    const tenantId = tenants[tenantIndex];
    if (tenantId === undefined) continue;

    const inFlight = tenantInFlight.get(tenantId) ?? 0;
    if (config.tenantSoftCap > 0 && inFlight >= config.tenantSoftCap) continue;

    for (const candidate of candidates) {
      if (candidate.tenantId !== tenantId) continue;
      if (candidate.leased || candidate.parked) continue;
      if (!enabled(candidate.lane)) continue;
      return { candidate, nextCursor: (tenantIndex + 1) % tenants.length };
    }
  }

  return null;
}
