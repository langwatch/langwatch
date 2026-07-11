/**
 * Server-side turn recovery (ADR-045/046 follow-on).
 *
 * The turn processor already knows the turn failed and WHY — it classified the
 * error itself. For a class of failures it can simply have another go, in
 * process, on the SAME turn, without the browser ever learning a thing: the
 * user's message is not re-posted (it was never un-posted), no PR permit is
 * re-reserved, no busy-guard is re-crossed, and the open stream just keeps
 * streaming. That is strictly better than bouncing the failure to the browser
 * and asking IT to drive a retry, so this is the primary recovery path. The
 * client policy (`features/langy/logic/langyRecoveryPolicy.ts`) is the safety
 * net for the two failures the server provably cannot fix from inside itself.
 *
 * WHO RECOVERS WHAT, and why the split is what it is:
 *
 *   langy_agent_at_capacity   SERVER. The manager rejects immediately with an
 *                             error frame, so a backoff-and-retry costs seconds,
 *                             not minutes, and comfortably fits the budget below.
 *   langy_agent_unavailable   SERVER. A refused connection fails fast, same deal.
 *
 *   langy_turn_timeout        CLIENT. The turn has ALREADY burned the whole
 *                             AGENT_CHAT_TIMEOUT_MS, which is also the browser's
 *                             attach budget — `attachTurnStream` has aborted its
 *                             follow by now, so nobody is listening to a retry we
 *                             run here. Only a fresh POST buys a fresh budget.
 *   langy_worker_restarting   CLIENT. The pod is draining. This process is going
 *                             away; it cannot sleep and try again. (See the drain
 *                             handler in langy-turn.processor.ts.)
 *
 *   langy_agent_session_lost  NOBODY. Terminal — the session is gone; a retry
 *                             walks into the same wall. The user sends again.
 *   unknown                   NOBODY. We do not retry what we cannot name.
 *
 * THE BUDGET. `attachTurnStream` bounds the browser's attach to
 * AGENT_CHAT_TIMEOUT_MS from the moment it attached. A server retry that
 * outlives that budget streams into a socket nobody is reading: the user sees
 * the answer stop dead, with no error and no card. So every retry is checked
 * against the time already spent — we only try again if the wait AND a real
 * turn's worth of headroom still fit.
 */

import { AGENT_CHAT_TIMEOUT_MS } from "./langy-turn-errors";

/** Enough of the budget left to be worth trying: a wait plus a real answer. */
export const MIN_RETRY_HEADROOM_MS = 20_000;

/** Backoff before attempt N (1-based) for a manager that is busy, not broken. */
const AT_CAPACITY_WAITS = [4_000, 10_000, 20_000] as const;

/** Backoff before attempt N (1-based) for a manager that isn't answering. */
const UNAVAILABLE_WAITS = [1_000, 3_000, 8_000] as const;

/**
 * The status line the user sees while the server re-drives the turn — rendered
 * as a calm line in the message flow, never as an error card, because nothing
 * is broken and there is nothing for them to do.
 *
 * The wait is stated rather than counted down: the browser does not know the
 * server's schedule, and a countdown that drifts is worse than a plain number.
 */
const STATUS_COPY: Record<string, (seconds: number) => string> = {
  langy_agent_at_capacity: (s) => `Langy is busy — trying again in ${s}s…`,
  langy_agent_unavailable: () => "Reconnecting to Langy…",
};

interface ServerRecoverySchedule {
  waits: readonly number[];
}

/**
 * The kinds THIS process can fix by trying again. Everything absent from this
 * table is not server-recoverable — including any kind added to the taxonomy
 * tomorrow, which fails safe into "terminal" rather than into a retry loop.
 */
const SERVER_RECOVERABLE: Record<string, ServerRecoverySchedule> = {
  langy_agent_at_capacity: { waits: AT_CAPACITY_WAITS },
  langy_agent_unavailable: { waits: UNAVAILABLE_WAITS },
};

/** The kinds the server deliberately leaves to the browser. Documented above. */
export const CLIENT_RECOVERABLE_KINDS = [
  "langy_turn_timeout",
  "langy_worker_restarting",
] as const;

export interface ServerRecoveryDecision {
  /** Re-drive the turn in process. */
  retry: boolean;
  /** How long to wait first. 0 when `retry` is false. */
  delayMs: number;
  /** The status line to push onto the turn's stream while we wait. */
  status: string;
  /** Why we are NOT retrying — for the log, never for the user. */
  reason?:
    | "terminal-kind"
    | "attempts-exhausted"
    | "turn-produced-output"
    | "budget-exhausted";
}

const NO_RETRY = (reason: ServerRecoveryDecision["reason"]) => ({
  retry: false as const,
  delayMs: 0,
  status: "",
  reason,
});

/**
 * Should the turn processor re-drive this turn itself?
 *
 * Pure: no clock, no I/O. The caller passes the elapsed time it measured.
 *
 * `producedOutput` is the hard gate, and it outranks every other consideration.
 * A turn that emitted ANYTHING — a token of prose, a single tool call — must
 * never be silently replayed, for two independent reasons:
 *
 *   1. SIDE EFFECTS. The agent has no idempotency key (the chat route says so
 *      where it refuses to retry `/chat` internally). A tool call may already
 *      have opened a PR or created a prompt; a second pass opens a second one.
 *   2. THE STREAM. Those tokens are already in the durable buffer and already
 *      on the user's screen. Re-driving the turn would append a second answer
 *      after half of a first one.
 *
 * This is deliberately stronger than "did it run a MUTATING tool": it needs no
 * tool-name heuristic, and it is exactly true in the cases we want to retry —
 * at-capacity and unreachable both fail before the manager emits a single byte.
 */
export function resolveServerRecovery({
  kind,
  attemptsUsed,
  elapsedMs,
  producedOutput,
}: {
  /** The classified domain-error kind of the failure. */
  kind: string;
  /** Retries already spent on this turn (0 on the first failure). */
  attemptsUsed: number;
  /** Wall time this turn has already consumed, from its first manager call. */
  elapsedMs: number;
  /** Did this attempt emit any prose or run any tool? */
  producedOutput: boolean;
}): ServerRecoveryDecision {
  if (producedOutput) return NO_RETRY("turn-produced-output");

  const schedule = SERVER_RECOVERABLE[kind];
  if (!schedule) return NO_RETRY("terminal-kind");

  if (attemptsUsed >= schedule.waits.length) {
    return NO_RETRY("attempts-exhausted");
  }

  const delayMs = schedule.waits[attemptsUsed]!;

  // The browser's attach dies at AGENT_CHAT_TIMEOUT_MS. A retry that lands
  // after that streams into a socket nobody is reading — worse than an honest
  // error card, because the user just sees the answer stop.
  const remainingMs = AGENT_CHAT_TIMEOUT_MS - elapsedMs;
  if (remainingMs < delayMs + MIN_RETRY_HEADROOM_MS) {
    return NO_RETRY("budget-exhausted");
  }

  const status = STATUS_COPY[kind]!(Math.round(delayMs / 1_000));
  return { retry: true, delayMs, status };
}
