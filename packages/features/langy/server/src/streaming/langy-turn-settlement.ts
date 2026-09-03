import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy-contract";
import type { LangyStreamEntry } from "./langy-token-buffer";
import { LANGY_LIVENESS } from "./langy-streaming.constants";

/** Decides a safe synthetic terminal when the live stream missed one. */
export function decideSyntheticTerminal({
  status,
  lastError,
  heartbeatStale,
}: {
  status: string;
  lastError: string | null;
  heartbeatStale: boolean;
}): LangyStreamEntry | null {
  if (!heartbeatStale) {
    return null;
  }
  if (status === LANGY_CONVERSATION_STATUS.ACTIVE || status === LANGY_CONVERSATION_STATUS.RUNNING) {
    return null;
  }
  if (status === LANGY_CONVERSATION_STATUS.FAILED) {
    return { type: "error", error: lastError ?? "Turn failed" };
  }
  if (status === LANGY_CONVERSATION_STATUS.IDLE) {
    return { type: "end" };
  }
  return null;
}

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
