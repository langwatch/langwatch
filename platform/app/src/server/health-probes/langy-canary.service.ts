/**
 * The Langy canary health probe.
 *
 * Sends one real user turn ("Hi Langy.") through the same in-process turn
 * service the browser and the key-authed API use, holds until the turn settles
 * on the durable fold, and says what broke: healthy, or one of exactly three
 * named reasons — `timeout`, `turn_failed`, `empty_reply`.
 *
 * The moving parts are separated so the interesting logic is testable with no
 * worker and no real waiting:
 *  - {@link classifyLangyCanaryOutcome} is the pure settlement → healthy/reason
 *    mapper.
 *  - {@link runLangyCanary} is the orchestrator: mint a fresh idempotency key →
 *    start the turn → await settlement → classify, all bounded by one real
 *    wall-clock budget. It reads its start/await boundary and its clock from
 *    injected {@link LangyCanaryDeps}.
 *  - {@link createSingleFlightLangyCanary} wraps the orchestrator so a second
 *    call for the same caller while one is in flight starts no second turn.
 *  - {@link runLangyHealthCanary} is the production entrypoint the route
 *    crosses: it builds the real deps from the authorized session and drives
 *    the single-flight guard.
 *
 * One attempt, not two: the plain HTTP monitor this probe is built for caps a
 * request at 60s, and Langy's first turn on a cold worker is the slowest part
 * of the path (`specs/langy/langy-worker-prewarm.feature`), so a retry cannot
 * fit inside one request. The monitor's own confirmation retry covers the
 * noise a single LLM turn carries.
 *
 * On a timeout the in-flight turn is left alone: the worker finishes or fails
 * it on its own schedule and the fold records whichever it was.
 *
 * @see specs/langy/langy-health-canary.feature
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";
import type { LangyChatMessageInput } from "~/server/app-layer/langy/langy-turn.service";
import {
  awaitTurnSettlement,
  type TurnSettlement,
} from "~/server/app-layer/langy/streaming/awaitTurnSettlement";
import type { Session } from "~/server/auth";

const logger = createLogger("langwatch:langy-canary");

/** Wall-time budget for one check: under the 60s a plain HTTP monitor allows. */
export const LANGY_CANARY_BUDGET_MS = 55_000;

/** The one user message every check sends. */
export const LANGY_CANARY_GREETING = "Hi Langy.";

/** The three, and only three, named ways a canary turn is unhealthy. */
export type LangyCanaryReason = "timeout" | "turn_failed" | "empty_reply";

/** The pure verdict of one settled turn. */
export type LangyCanaryVerdict =
  | { healthy: true }
  | { healthy: false; reason: LangyCanaryReason };

/** A settled canary outcome: the verdict plus the turn it came from. */
export type LangyCanaryOutcome = LangyCanaryVerdict & {
  conversationId?: string;
  turnId?: string;
  durationMs: number;
};

/** A settled outcome, or the busy signal a concurrent request gets. */
export type LangyCanaryResult = LangyCanaryOutcome | { busy: true };

/** The ids a started turn is followed by. */
export interface StartedTurn {
  conversationId: string;
  turnId: string;
}

/**
 * The start/await boundary and the clock the orchestrator drives, injected so
 * the whole budget/single-flight logic runs against fake timers in the unit
 * tests with no worker and no real waiting.
 */
export interface LangyCanaryDeps {
  /** Starts one canary turn under the given fresh idempotency key. */
  startTurn: (options: { idempotencyKey: string }) => Promise<StartedTurn>;
  /**
   * Holds until the turn settles on the fold, or `signal` aborts (then null).
   * The signal is the budget: the orchestrator owns the deadline.
   */
  awaitSettlement: (
    options: StartedTurn & { signal: AbortSignal },
  ) => Promise<TurnSettlement | null>;
  /** The clock, `Date.now` in production. */
  now: () => number;
  /** Overrides {@link LANGY_CANARY_BUDGET_MS}; a test seam. */
  budgetMs?: number;
}

/**
 * Maps one settlement onto healthy, or one of the three named reasons.
 *
 * `null` means the wait was aborted by the budget: `timeout`. A settlement
 * that did not succeed, or succeeded as `stopped` (nobody stops a canary turn,
 * so a stop is the worker giving up), is `turn_failed`. A completed turn whose
 * text is empty or whitespace is `empty_reply` — an empty answer is the one
 * failure a status code alone would hide.
 */
export function classifyLangyCanaryOutcome(
  settlement: TurnSettlement | null,
): LangyCanaryVerdict {
  if (!settlement) return { healthy: false, reason: "timeout" };
  if (!settlement.succeeded || settlement.outcome !== "completed") {
    return { healthy: false, reason: "turn_failed" };
  }
  if (settlement.text.trim().length === 0) {
    return { healthy: false, reason: "empty_reply" };
  }
  return { healthy: true };
}

/**
 * Resolves to `{ aborted: true }` the moment `signal` aborts, or never — so it
 * can be raced against a boundary await that might hang.
 */
function abortedPromise(signal: AbortSignal): Promise<{ aborted: true }> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve({ aborted: true });
    signal.addEventListener("abort", () => resolve({ aborted: true }), {
      once: true,
    });
  });
}

/**
 * One check: mint a fresh key, start the turn, wait for settlement, classify.
 * Everything runs under one `AbortSignal` armed with the budget, so a start
 * that hangs and a turn that never settles both report `timeout` inside the
 * documented contract instead of wedging the probe. A start that THROWS is
 * `turn_failed`: the turn service refused or broke before a turn existed.
 *
 * A fresh UUID per run is what keeps the check honest: Langy replays a
 * repeated idempotency key per caller, so a fixed key would report the first
 * turn's outcome forever.
 */
export async function runLangyCanary(
  deps: LangyCanaryDeps,
): Promise<LangyCanaryOutcome> {
  const startedAt = deps.now();
  const budget = new AbortController();
  const timer = setTimeout(
    () => budget.abort(),
    deps.budgetMs ?? LANGY_CANARY_BUDGET_MS,
  );
  const aborted = abortedPromise(budget.signal);
  let started: StartedTurn | undefined;

  try {
    const startResult = await Promise.race([
      deps.startTurn({ idempotencyKey: randomUUID() }),
      aborted,
    ]);
    if ("aborted" in startResult) {
      return {
        healthy: false,
        reason: "timeout",
        durationMs: deps.now() - startedAt,
      };
    }
    started = startResult;

    // Raced as well as signalled: the settlement wait reads the conversation
    // fold, and a wedged read would otherwise hold the probe past its budget.
    const settlement = await Promise.race([
      deps.awaitSettlement({ ...started, signal: budget.signal }),
      aborted,
    ]);
    return {
      ...classifyLangyCanaryOutcome(
        settlement !== null && "aborted" in settlement ? null : settlement,
      ),
      ...started,
      durationMs: deps.now() - startedAt,
    };
  } catch (error) {
    logger.error(
      { error, ...started },
      "Langy canary could not start or follow its turn",
    );
    return {
      healthy: false,
      reason: "turn_failed",
      ...started,
      durationMs: deps.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps an orchestrator so that while one check is in flight, a concurrent
 * call for the SAME key starts no second turn and is told the probe is busy.
 * Keyed per caller (project + user), never global: two monitors on two
 * projects must not block each other. In-process only, which is enough for a
 * probe polled every few minutes.
 */
export function createSingleFlightLangyCanary(
  run: (deps: LangyCanaryDeps) => Promise<LangyCanaryOutcome>,
): (options: {
  key: string;
  deps: LangyCanaryDeps;
}) => Promise<LangyCanaryResult> {
  const inFlight = new Map<string, Promise<LangyCanaryOutcome>>();

  return ({ key, deps }) => {
    const existing = inFlight.get(key);
    if (existing) return Promise.resolve({ busy: true });
    const attempt = run(deps).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, attempt);
    return attempt;
  };
}

/**
 * Builds the production start/await boundary from the authorized session:
 * the turn starts through the same `startConversationTurn` the API route
 * calls, attributed to the key's owner, and settlement is read off the fold
 * through the same `awaitTurnSettlement` the `Prefer: wait` mode uses.
 */
export function buildProductionLangyCanaryDeps({
  projectId,
  session,
}: {
  projectId: string;
  session: Session;
}): LangyCanaryDeps {
  const messages: LangyChatMessageInput[] = [
    { role: "user", parts: [{ type: "text", text: LANGY_CANARY_GREETING }] },
  ];
  return {
    startTurn: ({ idempotencyKey }) =>
      getApp().langy.turns.startConversationTurn({
        projectId,
        idempotencyKey,
        session,
        requestedConversationId: null,
        messages,
        isRetry: false,
        turnContext: {},
      }),
    awaitSettlement: ({ conversationId, turnId, signal }) =>
      awaitTurnSettlement({
        projectId,
        conversationId,
        turnId,
        userId: session.user.id,
        signal,
      }),
    now: () => Date.now(),
  };
}

/** The process-wide guard, keyed per caller. */
const singleFlightCanary = createSingleFlightLangyCanary(runLangyCanary);

/**
 * The route's single entrypoint. Takes the project and session the Langy API
 * auth chain resolved, so the turn runs exactly as a key-authed turn would.
 */
export async function runLangyHealthCanary({
  projectId,
  session,
}: {
  projectId: string;
  session: Session;
}): Promise<LangyCanaryResult> {
  logger.info(
    { projectId, userId: session.user.id },
    "Running Langy canary health check",
  );
  return singleFlightCanary({
    key: `${projectId}/${session.user.id}`,
    deps: buildProductionLangyCanaryDeps({ projectId, session }),
  });
}
