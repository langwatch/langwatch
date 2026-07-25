/**
 * Which evaluators this particular install can actually run.
 *
 * Every evaluator LangWatch knows about is listed in AVAILABLE_EVALUATORS, but
 * a given install does not necessarily have the code behind all of them. The
 * PII detector is the one that matters today: it ships a natural-language
 * model larger than the rest of the evaluator environment put together, so a
 * local install skips it unless asked, and the person who then goes looking
 * for it deserves to be told that rather than shown a working-looking card
 * that fails with "internal error" when they run it.
 *
 * The default is AVAILABLE, deliberately. Container and Kubernetes installs
 * build the evaluator environment with every extra and never set this
 * variable, so silence has to mean "present". Only an install that
 * deliberately skipped it says so.
 */

export const PRESIDIO_ENABLE_ENV_VAR = "LANGWATCH_ENABLE_PRESIDIO";

export type EvaluatorUnavailability = {
  /** What is true, in the person's terms. */
  reason: string;
  /** What they do about it. */
  howToEnable: string;
};

function presidioEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[PRESIDIO_ENABLE_ENV_VAR]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return !["0", "false", "no", "off"].includes(raw);
}

/**
 * Returns why an evaluator cannot run here, or undefined when it can.
 */
export function evaluatorUnavailability(
  evaluatorType: string,
  env: NodeJS.ProcessEnv = process.env,
): EvaluatorUnavailability | undefined {
  if (evaluatorType.startsWith("presidio/") && !presidioEnabled(env)) {
    return {
      reason: "PII detection is not installed on this server.",
      howToEnable: `Set ${PRESIDIO_ENABLE_ENV_VAR}=true and restart LangWatch. It downloads a ~670MB language model the first time, which is why it is left out by default.`,
    };
  }
  return undefined;
}

/**
 * The message shown when someone runs an evaluator this install cannot run.
 * One sentence of what happened, one of what to do — the same pair the
 * evaluator picker shows, so the two never tell different stories.
 */
export function unavailableEvaluatorMessage(
  unavailability: EvaluatorUnavailability,
): string {
  return `${unavailability.reason} ${unavailability.howToEnable}`;
}
