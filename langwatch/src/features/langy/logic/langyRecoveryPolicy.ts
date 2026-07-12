import { KNOWN_LANGY_ERROR_KINDS } from "./langyErrorExplainer";

/**
 * The CLIENT half of Langy's turn-recovery policy (ADR-045/046 follow-on).
 *
 * Recovery happens on the SERVER first. The turn processor already knows the
 * turn failed and why, so for the failures it can fix by simply trying again it
 * does exactly that, in process, on the same turn — the browser never learns a
 * thing (see `server/app-layer/langy/execution/langy-turn-recovery.ts`). That is
 * strictly better than bouncing a failure to the browser and asking IT to drive
 * a retry: nothing is re-posted, no permit is re-reserved, the open stream just
 * keeps streaming.
 *
 * So an error that reaches THIS module is one the server could not fix, and the
 * division is deliberate:
 *
 *   langy_worker_restarting  RETRY HERE. The pod was draining — it could not
 *                            sleep and try again, because it was going away.
 *                            The browser is the only thing still standing.
 *   langy_turn_timeout       RETRY HERE. The turn burned the whole timeout, which
 *                            is also the browser's stream-attach budget; a server
 *                            retry would stream into a socket nobody is reading.
 *                            Only a fresh POST buys a fresh budget.
 *
 *   langy_agent_at_capacity  DO NOT RETRY HERE. The server already backed off and
 *   langy_agent_unavailable  retried these — three times, with growing waits. If
 *                            one still reached the browser, the budget is SPENT.
 *                            Retrying again here would silently double it and
 *                            hold the user in a spinner for another minute.
 *
 *   langy_github_not_connected
 *                            AWAITING THE USER. Not a failure, and not a dead
 *                            end: a prerequisite is missing and only a human can
 *                            supply it. No auto-retry (backing off connects
 *                            nobody's account) and NO error card — the panel
 *                            draws the GitHub connect card in the message flow,
 *                            and connecting re-drives the turn.
 *
 *   langy_agent_session_lost TERMINAL. The session is gone; a retry walks into
 *                            the same wall. The user sends again — a fresh turn,
 *                            a fresh session.
 *   unknown                  TERMINAL. We do not retry what we cannot name.
 *
 * Pure. No timers, no React, no UI — `hooks/useLangyTurnRecovery.ts` owns the
 * clock and `components/LangyRecoveringLine.tsx` owns the pixels.
 *
 * FAIL SAFE. A kind we don't recognise — a new backend kind, a garbled payload —
 * is NOT retried. Guessing at a failure we can't name is how you get a retry
 * loop against a wall. The unit test pins every kind in `KNOWN_LANGY_ERROR_KINDS`
 * to an explicit entry, so adding a backend kind without a deliberate policy
 * fails loudly rather than defaulting into "retry forever".
 */

/**
 * HOW a failure gets out of its hole. "Don't auto-retry" is not one answer, it
 * is two very different ones, and collapsing them is how a setup step ends up
 * painted red:
 *
 *   auto           We fix it ourselves. Back off, re-drive, say nothing alarming.
 *   awaiting-user  Nothing is broken and nothing is lost — a PREREQUISITE is
 *                  missing, and only a human can supply it (connect GitHub).
 *                  Backing off changes nothing, so there is no auto-retry; but
 *                  this is emphatically NOT a dead end, and it must never render
 *                  as an error. The UI offers the fix inline, at the point the
 *                  turn stopped, and re-drives the turn once it's done.
 *   terminal       We are genuinely stuck. Show the card; the user decides.
 */
export type LangyRecoveryDisposition = "auto" | "awaiting-user" | "terminal";

/** A retry plan for one error kind. `delayMs` is keyed on the 1-based attempt. */
export interface LangyRecoveryPolicy {
  kind: string;
  /** What KIND of way out this failure has. See LangyRecoveryDisposition. */
  disposition: LangyRecoveryDisposition;
  /** Whether an AUTOMATIC retry is allowed. Only ever true for `auto`. */
  retry: boolean;
  /** Maximum AUTOMATIC attempts. 0 unless `retry`. */
  attempts: number;
  /** Wait before attempt N (1-based). Returns 0 for a non-retrying policy. */
  delayMs: (attempt: number) => number;
  /** The calm line shown in the message flow while the retry is pending. */
  recoveringMessage: string;
}

/** Genuinely stuck: show the error card, let the user decide. */
function terminal(kind: string): LangyRecoveryPolicy {
  return {
    kind,
    disposition: "terminal",
    retry: false,
    attempts: 0,
    delayMs: () => 0,
    recoveringMessage: "",
  };
}

/**
 * Blocked on a human, not on a fault. No auto-retry — no amount of backing off
 * connects someone's GitHub account — but no error card either: the UI renders
 * the prerequisite's own affordance (the connect card) in the message flow, and
 * re-drives the turn once the user supplies what was missing.
 *
 * The re-drive MUST go through the same non-duplicating path every other retry
 * uses (`regenerate()` → `trigger: "regenerate-message"`), or the user's message
 * is posted a second time. See `hooks/useLangyTurnRecovery.ts`.
 */
function awaitingUser(kind: string): LangyRecoveryPolicy {
  return {
    kind,
    disposition: "awaiting-user",
    retry: false,
    attempts: 0,
    delayMs: () => 0,
    recoveringMessage: "",
  };
}

/** A fixed schedule of waits — index 0 is the wait before attempt 1. */
function schedule(waits: readonly number[]): (attempt: number) => number {
  return (attempt) => waits[Math.min(Math.max(attempt, 1), waits.length) - 1]!;
}

/**
 * The first wait for a worker restart is not "as fast as possible" on purpose.
 * The conversation fold is projected asynchronously off the event log, and the
 * chat route's busy-guard 409s while it still reads `running`. `failTurn` is
 * dispatched a beat before the browser sees the error, so a retry fired
 * instantly would race the projection and bounce off the guard. ~1.5s buys the
 * fold time to terminalize; the second attempt buys a lot more.
 */
const WORKER_RESTART_WAITS = [1_500, 4_000] as const;

/** A timeout is expensive to repeat — one more go, then hand it to the user. */
const TIMEOUT_WAITS = [2_000] as const;

/** A failed spawn is usually transient; give it a moment and one more go. */
const SPAWN_RETRY_WAITS = [2_000, 6_000] as const;

const POLICIES: Record<string, LangyRecoveryPolicy> = {
  // A deploy drained the worker mid-turn. Nothing was lost — the user's message
  // is already on record and the answer had not been finalized. This is the one
  // failure the user should never even have to acknowledge.
  langy_worker_restarting: {
    kind: "langy_worker_restarting",
    disposition: "auto",
    retry: true,
    attempts: WORKER_RESTART_WAITS.length,
    delayMs: schedule(WORKER_RESTART_WAITS),
    recoveringMessage: "Langy restarted — picking up where it left off…",
  },

  // The turn blew its budget. Worth exactly one more go: if the question is
  // genuinely too big, a second timeout is 2 more minutes of the user's life,
  // and the card's copy already tells them to narrow the ask.
  langy_turn_timeout: {
    kind: "langy_turn_timeout",
    disposition: "auto",
    retry: true,
    attempts: TIMEOUT_WAITS.length,
    delayMs: schedule(TIMEOUT_WAITS),
    recoveringMessage: "Taking another run at that…",
  },

  // The worker died mid-turn and the sweep noticed. Same shape as a restart:
  // nothing was lost, so re-drive it rather than making the user re-ask.
  langy_turn_stalled: {
    kind: "langy_turn_stalled",
    disposition: "auto",
    retry: true,
    attempts: SPAWN_RETRY_WAITS.length,
    delayMs: schedule(SPAWN_RETRY_WAITS),
    recoveringMessage: "Langy stopped — picking your reply back up…",
  },

  // A spawn that failed is usually transient (a slow skill install, a readiness
  // timeout under load) and the next one succeeds. Retry it here, bounded — the
  // SERVER cannot, because the spawn it would retry is the one that just died.
  langy_worker_spawn_failed: {
    kind: "langy_worker_spawn_failed",
    disposition: "auto",
    retry: true,
    attempts: SPAWN_RETRY_WAITS.length,
    delayMs: schedule(SPAWN_RETRY_WAITS),
    recoveringMessage: "Langy is starting up…",
  },

  // ALREADY RETRIED BY THE SERVER — three times, with growing waits, showing a
  // status line on the live stream the whole while. Reaching the browser at all
  // means that budget is spent, so retrying here would just double it behind a
  // spinner. The user gets the card and decides.
  langy_agent_unavailable: terminal("langy_agent_unavailable"),
  langy_agent_at_capacity: terminal("langy_agent_at_capacity"),

  // TERMINAL. The opencode session backing this turn is gone; the manager
  // recycles the worker and the next turn gets a fresh session. Re-driving the
  // SAME turn walks straight back into the same wall. The user sends again — a
  // new turn, a new session — and the card says exactly that.
  langy_agent_session_lost: terminal("langy_agent_session_lost"),

  // Not turn failures — the conversation itself is gone or isn't theirs.
  // Retrying cannot change either fact.
  langy_conversation_not_found: terminal("langy_conversation_not_found"),
  langy_conversation_not_owned: terminal("langy_conversation_not_owned"),

  // NOT a failure and NOT a dead end: Langy needs GitHub and the user hasn't
  // connected it. Nothing broke, nothing was lost, and there is a perfectly good
  // next action — so no auto-retry (backing off connects nobody's account), and
  // emphatically no red card. The explainer marks this `render: "suppress"` and
  // the panel draws the GitHub connect card in the message flow, right where the
  // turn stopped; connecting re-drives the turn so the user never retypes.
  langy_github_not_connected: awaitingUser("langy_github_not_connected"),

  // Unhandled. We do not know what we would be retrying INTO, so we don't.
  unknown: terminal("unknown"),
};

/** The kinds with an explicit, deliberate policy. Pinned by the unit test. */
export const LANGY_RECOVERY_POLICIES: Readonly<
  Record<string, LangyRecoveryPolicy>
> = POLICIES;

/**
 * The policy for an error kind. Anything unrecognised — including a kind the
 * backend adds tomorrow — is terminal, never retried.
 */
export function langyRecoveryPolicy(kind: string): LangyRecoveryPolicy {
  return POLICIES[kind] ?? terminal(kind);
}

/**
 * Whether THIS failure, in THIS turn, may be re-driven automatically.
 *
 * The kind's policy is necessary but not sufficient. A turn that already ran a
 * tool which CHANGES the project (opened a PR, created a prompt, started a
 * run) cannot be safely replayed: the agent has no idempotency key, so a
 * second pass can open a second PR. The route says as much where it refuses to
 * retry `/chat` internally. When the turn touched something, we stop and hand
 * the decision to the user via the card — replaying a side effect is their call
 * to make, not ours.
 */
export function canAutoRecover({
  kind,
  attemptsUsed,
  sideEffectsObserved,
}: {
  kind: string;
  /** Auto-retries already spent on this failure chain (0 on the first failure). */
  attemptsUsed: number;
  /** Did the failed turn already run a project-mutating tool? */
  sideEffectsObserved: boolean;
}): boolean {
  if (sideEffectsObserved) return false;
  const policy = langyRecoveryPolicy(kind);
  return policy.retry && attemptsUsed < policy.attempts;
}

/**
 * Tool names that CHANGE something. Langy's catalog splits cleanly: reads are
 * `search_*` / `get_*` / `list_*`, writes are `create_*` / `update_*` /
 * `delete_*` / `run_*` (see the system block in `routes/langy.ts`), plus the
 * GitHub PR path and the raw file/shell tools opencode exposes.
 */
const MUTATING_TOOL_PREFIXES = [
  "create_",
  "update_",
  "delete_",
  "run_",
] as const;
const MUTATING_TOOL_NAMES = new Set([
  "bash",
  "write",
  "edit",
  "patch",
  "multiedit",
]);

/** Whether a tool call, by name, may have changed the project. */
export function isMutatingLangyTool(toolName: string): boolean {
  const name = toolName
    .trim()
    .toLowerCase()
    .replace(/^tool-/, "");
  if (MUTATING_TOOL_NAMES.has(name)) return true;
  if (name.includes("github") || name.includes("pull_request")) return true;
  return MUTATING_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Every kind the explainer knows about — the guard test's input set. */
export const RECOVERY_POLICY_KINDS = [
  ...KNOWN_LANGY_ERROR_KINDS,
  "unknown",
] as const;
