/**
 * Which evaluators this particular install can actually run. Moved from the platform app's
 * `server/evaluations/installedEvaluators.ts` unchanged.
 */
import type { EvaluatorUnavailability } from "../transport/api-trpc/evaluation.api";

export const PRESIDIO_ENABLE_ENV_VAR = "LANGWATCH_ENABLE_PRESIDIO";
export const LINGUA_ENABLE_ENV_VAR = "LANGWATCH_ENABLE_LINGUA";

/** The environment as this reads it: names to raw values, nothing more. */
export type EvaluatorInstallEnvironment = Readonly<Record<string, string | undefined>>;

export class EvaluatorAvailabilityService {
  static create(): EvaluatorAvailabilityService {
    return new EvaluatorAvailabilityService();
  }

  private static explicitlyDisabled(input: {
    environment: EvaluatorInstallEnvironment;
    variable: string;
  }): boolean {
    const raw = input.environment[input.variable]?.trim().toLowerCase();
    if (raw === undefined || raw === "") {
      return false;
    }

    return ["0", "false", "no", "off"].includes(raw);
  }

  /** Why an evaluator cannot run on this install, or undefined when it can. */
  static tryEvaluatorUnavailability(input: {
    evaluatorType: string;
    environment: EvaluatorInstallEnvironment;
  }): EvaluatorUnavailability | undefined {
    if (
      input.evaluatorType.startsWith("presidio/") &&
      EvaluatorAvailabilityService.explicitlyDisabled({
        environment: input.environment,
        variable: PRESIDIO_ENABLE_ENV_VAR,
      })
    ) {
      return {
        reason: "PII detection is not installed on this server.",
        howToEnable: `Set ${PRESIDIO_ENABLE_ENV_VAR}=true and restart LangWatch. It downloads a ~670MB language model the first time, which is why it is left out by default.`,
      };
    }

    if (
      input.evaluatorType.startsWith("lingua/") &&
      EvaluatorAvailabilityService.explicitlyDisabled({
        environment: input.environment,
        variable: LINGUA_ENABLE_ENV_VAR,
      })
    ) {
      return {
        reason: "Language detection is not installed on this server.",
        howToEnable: `Set ${LINGUA_ENABLE_ENV_VAR}=true and restart LangWatch. It downloads ~95MB of language models the first time, which is why it is left out by default.`,
      };
    }

    return undefined;
  }

  /**
   * The sentence shown when somebody runs an evaluator this install cannot run. One clause of
   * what happened and one of what to do — the same pair the evaluator picker shows, so the two
   * never tell different stories.
   */
  static unavailableEvaluatorMessage(input: { unavailability: EvaluatorUnavailability }): string {
    return `${input.unavailability.reason} ${input.unavailability.howToEnable}`;
  }
}
