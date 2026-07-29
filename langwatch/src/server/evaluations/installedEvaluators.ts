/**
 * Which evaluators this particular install can actually run.
 *
 * Every evaluator LangWatch knows about is listed in AVAILABLE_EVALUATORS, but
 * a given install does not necessarily have the code behind all of them. A
 * local install skips the heavyweight ones unless asked: the PII detector
 * ships a natural-language model larger than the rest of the evaluator
 * environment put together, language detection carries ~95MB of language
 * models, and the deprecated legacy evaluators pull a few hundred MB that
 * exist only so evaluations saved years ago keep running. The person who then
 * goes looking for one of these deserves to be told that, rather than shown a
 * working-looking card that fails with "internal error" when they run it.
 *
 * The default is AVAILABLE, deliberately. Container and Kubernetes installs
 * build the evaluator environment with every extra and never set these
 * variables, so silence has to mean "present". Only an install that
 * deliberately skipped one says so.
 */

export const PRESIDIO_ENABLE_ENV_VAR = "LANGWATCH_ENABLE_PRESIDIO";
export const LINGUA_ENABLE_ENV_VAR = "LANGWATCH_ENABLE_LINGUA";
export const LEGACY_EVALUATORS_ENABLE_ENV_VAR =
  "LANGWATCH_ENABLE_LEGACY_EVALUATORS";

export type EvaluatorUnavailability = {
  /** What is true, in the person's terms. */
  reason: string;
  /** What they do about it. */
  howToEnable: string;
  /**
   * Whether the evaluator should disappear from pickers entirely instead of
   * showing as a disabled card. Deprecated families earn this: a card someone
   * cannot choose is guidance for a current evaluator, and clutter for one
   * nobody should be adopting anyway. Execution still gets the clear message
   * either way, since something saved long ago may reference it.
   */
  isHiddenFromUi?: boolean;
};

function explicitlyDisabled({
  env,
  envVar,
}: {
  env: NodeJS.ProcessEnv;
  envVar: string;
}): boolean {
  const raw = env[envVar]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return false;
  return ["0", "false", "no", "off"].includes(raw);
}

/**
 * Returns why an evaluator cannot run here, or undefined when it can.
 */
export function evaluatorUnavailability({
  evaluatorType,
  env = process.env,
}: {
  evaluatorType: string;
  env?: NodeJS.ProcessEnv;
}): EvaluatorUnavailability | undefined {
  if (
    evaluatorType.startsWith("presidio/") &&
    explicitlyDisabled({ env, envVar: PRESIDIO_ENABLE_ENV_VAR })
  ) {
    return {
      reason: "PII detection is not installed on this server.",
      howToEnable: `Set ${PRESIDIO_ENABLE_ENV_VAR}=true and restart LangWatch. It downloads a ~670MB language model the first time, which is why it is left out by default.`,
    };
  }
  if (
    evaluatorType.startsWith("lingua/") &&
    explicitlyDisabled({ env, envVar: LINGUA_ENABLE_ENV_VAR })
  ) {
    return {
      reason: "Language detection is not installed on this server.",
      howToEnable: `Set ${LINGUA_ENABLE_ENV_VAR}=true and restart LangWatch. It downloads ~95MB of language models the first time, which is why it is left out by default.`,
    };
  }
  if (
    evaluatorType.startsWith("legacy/") &&
    explicitlyDisabled({ env, envVar: LEGACY_EVALUATORS_ENABLE_ENV_VAR })
  ) {
    return {
      reason: "Legacy evaluators are not installed on this server.",
      howToEnable: `They are deprecated; prefer their current equivalents. If a saved evaluation still needs one, set ${LEGACY_EVALUATORS_ENABLE_ENV_VAR}=true and restart LangWatch.`,
      isHiddenFromUi: true,
    };
  }
  return undefined;
}

/**
 * The message shown when someone runs an evaluator this install cannot run.
 * One sentence of what happened, one of what to do, the same pair the
 * evaluator picker shows, so the two never tell different stories.
 */
export function unavailableEvaluatorMessage({
  unavailability,
}: {
  unavailability: EvaluatorUnavailability;
}): string {
  return `${unavailability.reason} ${unavailability.howToEnable}`;
}
