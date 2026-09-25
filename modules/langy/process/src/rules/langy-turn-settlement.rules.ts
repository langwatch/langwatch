import { LANGY_CONVERSATION_STATUS, type LangyStreamEntry } from "@langwatch/langy-contract";

import { LANGY_LIVENESS } from "./langy-streaming-constants.rules.ts";

export const WEDGED_TURN_PATIENCE_MS = LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 3;

export function shouldAbandonWedgedTurn({
  heartbeatStale,
  stalePolls,
  pollMs,
  patienceMs = WEDGED_TURN_PATIENCE_MS,
}: {
  heartbeatStale: boolean;
  stalePolls: number;
  pollMs: number;
  patienceMs?: number;
}): boolean {
  if (!heartbeatStale) {
    return false;
  }

  return stalePolls * pollMs >= patienceMs;
}

export interface TurnHealth {
  isStale: boolean;
  terminal: LangyStreamEntry | null;
}

export type SettlementOutcome =
  | { kind: "terminal"; entry: LangyStreamEntry }
  | { kind: "abandoned" };

export interface SettlementStreaks {
  settled: number;
  stale: number;
}

export const NO_SETTLEMENT_STREAKS: SettlementStreaks = {
  settled: 0,
  stale: 0,
};

export function advanceSettlement({
  health,
  streaks,
  pollMs,
  confirmPolls,
}: {
  health: TurnHealth | null;
  streaks: SettlementStreaks;
  pollMs: number;
  confirmPolls: number;
}): { streaks: SettlementStreaks; outcome: SettlementOutcome | null } {
  const next: SettlementStreaks = {
    settled: health?.terminal ? streaks.settled + 1 : 0,
    stale: health?.isStale ? streaks.stale + 1 : 0,
  };

  if (health?.terminal && next.settled >= confirmPolls) {
    return {
      streaks: next,
      outcome: { kind: "terminal", entry: health.terminal },
    };
  }

  if (
    shouldAbandonWedgedTurn({
      heartbeatStale: next.stale > 0,
      stalePolls: next.stale,
      pollMs,
    })
  ) {
    return { streaks: next, outcome: { kind: "abandoned" } };
  }

  return { streaks: next, outcome: null };
}

/** The terminal a settled fold implies once the heartbeat went stale; never over a live beat. */
export function deriveSyntheticTerminal({
  status,
  lastError,
  heartbeatStale,
}: {
  status: string;
  lastError: string | null;
  heartbeatStale: boolean;
}): LangyStreamEntry | undefined {
  if (!heartbeatStale) return undefined;
  if (status === LANGY_CONVERSATION_STATUS.FAILED) {
    return { type: "error", error: lastError ?? "Turn failed" };
  }
  if (status === LANGY_CONVERSATION_STATUS.IDLE) return { type: "end" };
  return undefined;
}
