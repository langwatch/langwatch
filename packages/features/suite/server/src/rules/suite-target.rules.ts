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
