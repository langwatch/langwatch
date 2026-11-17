/**
 * The classifier channel's breaker: after enough sends in a row find the classifier down, it
 * stops sending and lets one probe through per interval, until one is answered. Each text keeps
 * its own attempts and backoff; only the sends are held back. Pure, one state per pod.
 * @see modules/instant-eval/specs/classifier.feature
 */

export const INSTANT_EVAL_CLASSIFIER_BREAKER = {
  /** Sends in a row that found the classifier down before it stops being sent to. */
  openAfterFailures: 16,
  /** How often one probe goes through while it is stopped. */
  probeEveryMs: 10_000,
} as const;

/**
 * What one send said about the classifier: `down` for a 5xx other than 529, a transport error
 * or our own timeout; `up` for an answer or a too-large refusal; `neutral` for a rate limit or
 * a permanent refusal, which say nothing about whether it is up.
 */
export type ClassifierSendHealth = "down" | "up" | "neutral";

export interface ClassifierBreakerState {
  readonly consecutiveFailures: number;
  /** When it stopped sending, or last let a probe through; null while closed. */
  readonly openedAt: number | null;
  /** The number of the probe still unanswered, if any. */
  readonly probeInFlight: number | null;
  /** Probes let through so far; numbers each probe, so only its own send frees it. */
  readonly probesSent: number;
}

export const CLOSED_CLASSIFIER_BREAKER: ClassifierBreakerState = {
  consecutiveFailures: 0,
  openedAt: null,
  probeInFlight: null,
  probesSent: 0,
};

/** Whether this send may go out, the state once it does, and its probe number if it is one. */
export function classifierBreakerAllowsSend({
  state,
  now,
}: {
  state: ClassifierBreakerState;
  now: number;
}): {
  readonly isAllowed: boolean;
  readonly state: ClassifierBreakerState;
  readonly probe: number | null;
} {
  if (state.openedAt === null) return { isAllowed: true, state, probe: null };
  const { probeEveryMs } = INSTANT_EVAL_CLASSIFIER_BREAKER;
  if (state.probeInFlight !== null || now - state.openedAt < probeEveryMs) {
    return { isAllowed: false, state, probe: null };
  }
  const probe = state.probesSent + 1;
  return {
    isAllowed: true,
    state: { ...state, openedAt: now, probeInFlight: probe, probesSent: probe },
    probe,
  };
}

/** The state after a send that went out came back; `probe` is its number if it was one. */
export function recordClassifierSend({
  state,
  health,
  now,
  probe,
}: {
  state: ClassifierBreakerState;
  health: ClassifierSendHealth;
  now: number;
  probe: number | null;
}): ClassifierBreakerState {
  if (health === "up") return { ...CLOSED_CLASSIFIER_BREAKER, probesSent: state.probesSent };
  const probeInFlight =
    probe !== null && probe === state.probeInFlight ? null : state.probeInFlight;
  if (health === "neutral") return { ...state, probeInFlight };
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (state.openedAt !== null) {
    return { ...state, consecutiveFailures, openedAt: now, probeInFlight };
  }
  const { openAfterFailures } = INSTANT_EVAL_CLASSIFIER_BREAKER;
  return {
    ...state,
    consecutiveFailures,
    openedAt: consecutiveFailures >= openAfterFailures ? now : null,
    probeInFlight,
  };
}
