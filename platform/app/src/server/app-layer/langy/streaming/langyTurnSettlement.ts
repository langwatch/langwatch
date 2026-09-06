import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy";
import { LANGY_LIVENESS } from "./langy.streaming.constants";
import type { LangyStreamEntry } from "./langyTokenBuffer";

/**
 * Decide whether to synthesize a terminal stream entry for a turn whose live
 * terminal frame the durable buffer never received.
 *
 * `onTurnStream` tails the token buffer; when a refresh mid-turn misses the
 * worker's terminal frame (its relay connection dropped before it), the buffer
 * has no `end`/`error` and `follow()` would block until the hard per-turn
 * deadline — leaving the UI on the startup status for minutes though the turn already
 * finished server-side.
 *
 * We synthesize a terminal ONLY when BOTH hold, so a live or still-starting turn
 * is never cut off:
 *   - the per-turn heartbeat is STALE — a running turn keeps a fresh one; AND
 *   - the durable fold says the turn is no longer in flight. Its status flips to
 *     ACTIVE/RUNNING at `agent_turn_accepted`, BEFORE any output, so even a cold
 *     start (which streams nothing for its first ~10-20s) reads as in-flight, not
 *     settled.
 *
 * FAILED → `error` (carrying lastError); IDLE (completed) → `end`. Any other or
 * transitional status — including ARCHIVED and anything added later — yields
 * null (stay patient; never guess a terminal).
 *
 * `status` is deliberately `string`, not the `LANGY_CONVERSATION_STATUS` union:
 * it arrives from the conversation projection's bare string column
 * (`getById(): { status: string }`), so narrowing here would only buy a cast at
 * the call site that asserts something the data does not guarantee. Typo safety
 * is already structural — every comparison below is against the exported
 * constant, so a renamed or removed status fails to compile here, and an
 * unrecognised value falls through to the safe `null`.
 */
export function decideSyntheticTerminal({
  status,
  lastError,
  heartbeatStale,
}: {
  status: string;
  lastError: string | null;
  heartbeatStale: boolean;
}): LangyStreamEntry | null {
  // A live turn keeps a fresh heartbeat — never synthesize over one.
  if (!heartbeatStale) return null;

  if (
    status === LANGY_CONVERSATION_STATUS.ACTIVE ||
    status === LANGY_CONVERSATION_STATUS.RUNNING
  ) {
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

/**
 * How long a turn may go without proving it is alive before its live stream is
 * given up.
 *
 * The same 90 seconds the liveness subscriber waits before it treats a turn as
 * stalled (`HEARTBEAT_GRACE_MS * 3`), counted from the moment the heartbeat
 * first reads stale — which is itself 30 seconds after the last beat. So a
 * stream is only released once the worker has been silent for two minutes AND
 * the durable fold has not settled it, which is the wedged turn nothing else
 * will clean up.
 */
export const WEDGED_TURN_PATIENCE_MS = LANGY_LIVENESS.HEARTBEAT_GRACE_MS * 3;

/**
 * Whether to give up the live stream of a turn that neither settles nor beats.
 *
 * This is the ONLY reason a healthy turn's stream ends early, and it exists to
 * release the blocking Redis connection the tail holds. It replaces an absolute
 * deadline: the subscription used to be capped at the manager's own request
 * budget of two minutes, so a turn that ran longer went silent half-way
 * through. The panel kept the last thing it had heard on screen, and every
 * agent action after the cap found no page listening and ran on the backend
 * instead, which is what made a ten minute loop look like nothing was
 * happening. Length is not a symptom; silence is.
 */
export function shouldAbandonWedgedTurn({
  heartbeatStale,
  stalePolls,
  pollMs,
  patienceMs = WEDGED_TURN_PATIENCE_MS,
}: {
  heartbeatStale: boolean;
  /** Consecutive polls that read the heartbeat as stale, including this one. */
  stalePolls: number;
  pollMs: number;
  patienceMs?: number;
}): boolean {
  if (!heartbeatStale) return false;
  return stalePolls * pollMs >= patienceMs;
}

/** What one look at the durable fold and the heartbeat says about a turn. */
export interface TurnHealth {
  /** The heartbeat has not been refreshed inside its grace window. */
  isStale: boolean;
  /** The terminal to synthesize, when the turn has provably settled. */
  terminal: LangyStreamEntry | null;
}

/** How the tail should end, once the readings agree it should. */
export type SettlementOutcome =
  | { kind: "terminal"; entry: LangyStreamEntry }
  | { kind: "abandoned" };

/** Consecutive readings of each kind, carried between polls. */
export interface SettlementStreaks {
  settled: number;
  stale: number;
}

export const NO_SETTLEMENT_STREAKS: SettlementStreaks = {
  settled: 0,
  stale: 0,
};

/**
 * Fold one reading into the running streaks and say whether they now decide the
 * stream's fate.
 *
 * Both gates want their reading CONFIRMED over consecutive polls rather than
 * acted on the first time, because either one acting on a blip ends a stream
 * whose turn is alive. A reading of `null` is a poll that could not be made: it
 * says nothing about the worker, so it resets both counters rather than
 * counting towards either verdict.
 */
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
