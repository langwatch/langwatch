import { NoOpLogger } from "../../../../logger";
import { setupObservability } from "../index";

type SetupObservabilityOptions = NonNullable<Parameters<typeof setupObservability>[0]>;

/**
 * Shared setup for observability integration tests: LangWatch export disabled
 * (suites assert against in-memory processors, not the network), setup errors
 * thrown rather than swallowed, and a NoOpLogger to keep SDK diagnostics out of
 * test output. Callers pass serviceName/processors; everything else, including
 * `advanced`, is overridable and merges over these defaults.
 */
export function createIntegrationObservability(
  overrides: Omit<SetupObservabilityOptions, "langwatch"> & {
    langwatch?: SetupObservabilityOptions["langwatch"];
  },
): ReturnType<typeof setupObservability> {
  const { advanced, debug, ...rest } = overrides;
  return setupObservability({
    langwatch: "disabled",
    debug: { logger: new NoOpLogger(), ...debug },
    ...rest,
    advanced: { throwOnSetupError: true, ...advanced },
  });
}
