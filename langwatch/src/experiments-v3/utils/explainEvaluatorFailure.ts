import type {
  HandledErrorFault,
  SerializedHandledError,
  SerializedReason,
} from "@langwatch/handled-error";

/**
 * Whether a failure is something the reader has to go and configure, or
 * something that genuinely went wrong while running.
 *
 * Presentation only. A configuration failure is still recorded and still counted
 * exactly as before — what changes is that it stops being painted as an alarm. A
 * run whose evaluator was never given usable credentials did not break; it never
 * started, and a column of red says the opposite.
 */
export type EvaluatorFailureTone = "configuration" | "failure";

export type EvaluatorFailureExplanation = {
  /** Always ours. Never the upstream's sentence — see {@link UNRECOGNISED_FAILURE}. */
  headline: string;
  hint?: string;
  tone: EvaluatorFailureTone;
  /**
   * The upstream's own words, kept for display ONLY as attributed evidence
   * beside our copy, never as the headline.
   */
  raw?: string;
};

/**
 * Said only when the response actually names a key.
 *
 * Precise advice about the wrong thing costs more than vague advice about the
 * right one, so this is reserved for the case we can prove — see
 * {@link REFUSED_BY_ENDPOINT} for when we cannot.
 */
export const MISSING_MODEL_API_KEY = {
  headline: "Missing or invalid model API key",
  hint: "Add the provider key in Settings → AI Gateway, then re-run.",
  tone: "configuration",
} as const satisfies EvaluatorFailureExplanation;

/**
 * Said when the call was refused and nothing identifies which credential was
 * refused.
 *
 * A gateway in front of the endpoint rejects before the model is ever reached
 * and answers in its own words — AWS API Gateway's "Missing Authentication
 * Token" is the one seen in the wild, and it usually means the route or the
 * endpoint's own auth is wrong, not that a model provider key is missing.
 * Naming the model key there sends the reader to a settings page that is
 * working correctly.
 */
export const REFUSED_BY_ENDPOINT = {
  headline: "The evaluator endpoint refused the request",
  hint: "Its credentials were rejected. Check the model provider key, and the endpoint's own auth if it sits behind a gateway.",
  tone: "configuration",
} as const satisfies EvaluatorFailureExplanation;

/**
 * The last resort, and the reason this module exists.
 *
 * Without it the cell fell back to the first line of whatever came back, which
 * for a raw HTTP body is `403 {` — the upstream's punctuation, rendered in our
 * voice. The response that produced it was AWS API Gateway's, about neither
 * LangWatch nor the model provider, and it read as though the user's LangWatch
 * token were missing. A third party's prose is evidence to show, attributed;
 * it is never a label to render as ours.
 */
export const UNRECOGNISED_FAILURE = {
  headline: "The evaluator could not compare this row",
  tone: "failure",
} as const satisfies EvaluatorFailureExplanation;

/** Wording that identifies the refused credential as the model provider's. */
const NAMES_A_MODEL_API_KEY =
  /(api[\s_-]?key|authenticationerror|invalid[\s_-]?token|incorrect[\s_-]?api)/i;

/** Text that says the call was refused, for results with no structured error. */
const READS_AS_REFUSAL =
  /(\b401\b|\b403\b|unauthori[sz]ed|forbidden|missing authentication token|permission[\s_-]?denied)/i;

/**
 * The fault of a failure, preferring the outermost that states one.
 *
 * `reasons` is the causal chain — the evaluator's error wrapping the driver's
 * wrapping the provider's — and the outer layer does not always classify
 * itself: `EvaluatorExecutionError` defaults to `platform` because the
 * evaluator backend is ours, and only the site that recognises a 401/403
 * overrides it to `customer`. Walking inward finds the layer that actually
 * knew, instead of reading a default as an answer.
 */
function faultOf(
  error: SerializedHandledError | SerializedReason,
): HandledErrorFault | undefined {
  if (error.fault) return error.fault;

  for (const reason of error.reasons ?? []) {
    const fault = faultOf(reason);
    if (fault) return fault;
  }

  return undefined;
}

/** Whether any layer of the chain classified itself with the given code. */
function hasCode(
  error: SerializedHandledError | SerializedReason,
  predicate: (code: string) => boolean,
): boolean {
  if (predicate(error.code)) return true;
  return (error.reasons ?? []).some((reason) => hasCode(reason, predicate));
}

/** Whether any layer carries the typed auth sub-classifier. */
function isAuthFailure(
  error: SerializedHandledError | SerializedReason,
): boolean {
  if (error.meta?.reason === "auth_failed") return true;

  const status = error.meta?.httpStatus;
  if (status === 401 || status === 403) return true;

  return (error.reasons ?? []).some(isAuthFailure);
}

/**
 * Chooses between the two credential explanations.
 *
 * One function, so the two routes to the same failure cannot drift: a refusal
 * arrives structurally on new results and as a raw string on results stored
 * before evaluators carried a structured error, and both land here.
 */
function explainRefusal(
  details: string | undefined,
): EvaluatorFailureExplanation {
  return details && NAMES_A_MODEL_API_KEY.test(details)
    ? MISSING_MODEL_API_KEY
    : REFUSED_BY_ENDPOINT;
}

/**
 * What a failed comparison cell says, given whatever the result carried.
 *
 * Structured first: the error's own `code`, `meta` and `fault` — read through
 * the `reasons` chain — say what happened and whose problem it is, without
 * anyone parsing prose. `details` is consulted only to sharpen the wording, and
 * for rows stored before evaluators carried a structured error at all.
 */
export function explainEvaluatorFailure({
  error,
  details,
}: {
  error?: SerializedHandledError;
  details?: string;
}): EvaluatorFailureExplanation {
  const raw = details?.trim() || undefined;

  if (error) {
    const tone: EvaluatorFailureTone =
      faultOf(error) === "customer" ? "configuration" : "failure";

    if (isAuthFailure(error)) return { ...explainRefusal(raw), raw };

    if (hasCode(error, (code) => code === "evaluator_config_error")) {
      return {
        headline: "This evaluator is not configured to run",
        hint: "Open the evaluator's settings and complete its configuration.",
        tone: "configuration",
        raw,
      };
    }

    return { ...UNRECOGNISED_FAILURE, tone, raw };
  }

  if (!raw) return { headline: "Comparison failed", tone: "failure" };

  if (NAMES_A_MODEL_API_KEY.test(raw) || READS_AS_REFUSAL.test(raw)) {
    return { ...explainRefusal(raw), raw };
  }

  if (/rate[\s_-]?limit|\b429\b/i.test(raw)) {
    return {
      headline: "Judge model rate-limited",
      hint: "Slow the run down (lower concurrency) or try a different model.",
      tone: "failure",
      raw,
    };
  }

  if (/model not found|invalid model|does not exist/i.test(raw)) {
    return {
      headline: "Judge model not available",
      hint: "Pick a different model in the evaluator config.",
      tone: "configuration",
      raw,
    };
  }

  if (/timed? ?out/i.test(raw)) {
    return {
      headline: "Judge call timed out",
      hint: "Re-run, or try a faster model.",
      tone: "failure",
      raw,
    };
  }

  // Our own wording, written on the server with the variant names in it — the
  // one case where the detail IS the headline, because we wrote it.
  if (/waiting on|no output for this row|missingvariantoutput/i.test(raw)) {
    const dashIdx = raw.indexOf("—");
    return dashIdx > 0
      ? {
          headline: raw.slice(0, dashIdx).trim(),
          hint: raw.slice(dashIdx + 1).trim(),
          tone: "configuration",
        }
      : { headline: raw, tone: "configuration" };
  }

  if (/missing candidate output/i.test(raw)) {
    return {
      headline: "One of the candidates is blank",
      hint: "Its prompt returned an empty string — re-run that prompt or check what it's returning.",
      tone: "configuration",
      raw,
    };
  }

  return { ...UNRECOGNISED_FAILURE, raw };
}
