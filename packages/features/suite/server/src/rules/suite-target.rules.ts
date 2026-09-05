import {
  parseScenarioParameterDefinitions,
  partitionParameterDefinitions,
} from "@langwatch/scenario-contract";
import { targetLabels, type SuiteTarget } from "@langwatch/suite-contract";

/** A suite id, when the caller did not supply one. */
export function defaultSuiteId(): string {
  return `suite_${crypto.randomUUID()}`;
}

/** The url-safe name a suite is addressed by. */
export function suiteSlugOf(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "suite"
  );
}

/** Whether a target names an agent, however the caller spelled the type. */
export function isAgentTarget(target: SuiteTarget): boolean {
  switch (target.type) {
    case "http":
    case "code":
    case "workflow":
    // A connected target points at an Agent row like the other three. Its
    // reference id may also read `<name>@<environment>`, which the run
    // resolves to an agent id before membership is read.
    case "connected":
      return true;
    case "prompt":
      return false;
    default: {
      const unhandledType: never = target.type;

      throw new Error(`Unsupported suite target type: ${unhandledType}`);
    }
  }
}

/**
 * A secret value is typed once for the run and travels with the run alone. A
 * target's overrides are stored on the plan row in clear, so a secret among
 * them would be written where everyone who can open the plan reads it.
 */
export const TARGET_SECRET_REFUSAL =
  "A secret parameter is supplied once for the run, not per target.";

/** Whether any target's overrides name a parameter one of these scenarios declares secret. */
export function targetsOverrideASecret({
  scenarios,
  targets,
}: {
  scenarios: readonly { parameters: unknown }[];
  targets: readonly SuiteTarget[];
}): boolean {
  const secretNames = new Set(
    scenarios.flatMap((scenario) =>
      partitionParameterDefinitions(
        parseScenarioParameterDefinitions(scenario.parameters),
      ).secret.map((definition) => definition.name),
    ),
  );
  if (secretNames.size === 0) return false;

  return targets.some((target) =>
    Object.keys(target.runParameters ?? {}).some((name) => secretNames.has(name)),
  );
}
