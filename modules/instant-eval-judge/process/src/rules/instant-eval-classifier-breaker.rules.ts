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
  readonly isProbeInFlight: boolean;
}

export const CLOSED_CLASSIFIER_BREAKER: ClassifierBreakerState = {
  consecutiveFailures: 0,
  openedAt: null,
  isProbeInFlight: false,
};

/** Whether this send may go out, and the state once it does. */
export function classifierBreakerAllowsSend({
  state,
  now,
  breaker = INSTANT_EVAL_CLASSIFIER_BREAKER,
}: {
  state: ClassifierBreakerState;
  now: number;
  breaker?: typeof INSTANT_EVAL_CLASSIFIER_BREAKER;
}): { readonly isAllowed: boolean; readonly state: ClassifierBreakerState } {
  if (state.openedAt === null) return { isAllowed: true, state };
  if (state.isProbeInFlight || now - state.openedAt < breaker.probeEveryMs) {
    return { isAllowed: false, state };
  }
  return { isAllowed: true, state: { ...state, openedAt: now, isProbeInFlight: true } };
}

/** The state after a send that went out came back. */
export function recordClassifierSend({
  state,
  health,
  now,
  breaker = INSTANT_EVAL_CLASSIFIER_BREAKER,
}: {
  state: ClassifierBreakerState;
  health: ClassifierSendHealth;
  now: number;
  breaker?: typeof INSTANT_EVAL_CLASSIFIER_BREAKER;
}): ClassifierBreakerState {
  if (health === "up") return CLOSED_CLASSIFIER_BREAKER;
  if (health === "neutral") return { ...state, isProbeInFlight: false };
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (state.openedAt !== null) {
    return { consecutiveFailures, openedAt: now, isProbeInFlight: false };
  }
  return {
    consecutiveFailures,
    openedAt: consecutiveFailures >= breaker.openAfterFailures ? now : null,
    isProbeInFlight: false,
  };
}
