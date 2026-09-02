/**
 * Which evaluators this particular install can actually run.
 *
 * Moved from the platform app's `server/evaluations/installedEvaluators.ts`
 * unchanged. Every evaluator LangWatch knows about is listed in
 * `AVAILABLE_EVALUATORS`, but a given install does not necessarily carry the
 * code behind all of them: the PII detector ships a natural-language model
 * larger than the rest of the evaluator environment put together, and language
 * detection carries ~95MB of language models. Somebody who goes looking for
 * one of these deserves to be told that, rather than shown a working-looking
 * card that fails with "internal error" when they run it.
 *
 * The default is AVAILABLE, deliberately. Container and Kubernetes installs
 * build the evaluator environment with every extra and never set these
 * variables, so silence has to mean "present". Only an install that
 * deliberately skipped one says so.
 */
import type { EvaluatorUnavailability } from "../transport/api-trpc/evaluation.api";

export const PRESIDIO_ENABLE_ENV_VAR = "LANGWATCH_ENABLE_PRESIDIO";
export const LINGUA_ENABLE_ENV_VAR = "LANGWATCH_ENABLE_LINGUA";

/** The environment as this reads it: names to raw values, nothing more. */
export type EvaluatorInstallEnvironment = Readonly<Record<string, string | undefined>>;

function explicitlyDisabled(input: {
  environment: EvaluatorInstallEnvironment;
  variable: string;
}): boolean {
  const raw = input.environment[input.variable]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return false;
  return ["0", "false", "no", "off"].includes(raw);
}

/** Why an evaluator cannot run on this install, or undefined when it can. */
export function evaluatorUnavailability(input: {
  evaluatorType: string;
  environment: EvaluatorInstallEnvironment;
}): EvaluatorUnavailability | undefined {
  if (
    input.evaluatorType.startsWith("presidio/") &&
    explicitlyDisabled({ environment: input.environment, variable: PRESIDIO_ENABLE_ENV_VAR })
  ) {
    return {
      reason: "PII detection is not installed on this server.",
      howToEnable: `Set ${PRESIDIO_ENABLE_ENV_VAR}=true and restart LangWatch. It downloads a ~670MB language model the first time, which is why it is left out by default.`,
    };
  }
  if (
    input.evaluatorType.startsWith("lingua/") &&
    explicitlyDisabled({ environment: input.environment, variable: LINGUA_ENABLE_ENV_VAR })
  ) {
    return {
      reason: "Language detection is not installed on this server.",
      howToEnable: `Set ${LINGUA_ENABLE_ENV_VAR}=true and restart LangWatch. It downloads ~95MB of language models the first time, which is why it is left out by default.`,
    };
  }
  return undefined;
}

/**
 * The sentence shown when somebody runs an evaluator this install cannot run.
 *
 * One clause of what happened and one of what to do — the same pair the
 * evaluator picker shows, so the two never tell different stories.
 */
export function unavailableEvaluatorMessage(input: {
  unavailability: EvaluatorUnavailability;
}): string {
  return `${input.unavailability.reason} ${input.unavailability.howToEnable}`;
}
