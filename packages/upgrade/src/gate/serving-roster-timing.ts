/** Generous stale bound: a database blip must never take a process out of service (2026-10-09). */
export const SERVING_ROSTER_TIMING = { staleAfterMs: 10 * 60_000, refreshEveryMs: 15_000 } as const;

/** Writers before the roster count as present this long after the upgrade run (Round 47 E2). */
export const SERVING_ROSTER_PRE_ROSTER_GRACE_MS = 30 * 60_000;
