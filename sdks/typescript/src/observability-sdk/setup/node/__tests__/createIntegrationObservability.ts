import { NoOpLogger } from "../../../../logger";
import { setupObservability } from "../index";

type SetupObservabilityOptions = NonNullable<Parameters<typeof setupObservability>[0]>;

/**
 * Shared setup for observability integration tests: export disabled
 * (assert against in-memory processors), errors thrown not swallowed, and
 * a NoOpLogger. Callers override serviceName/processors/`advanced` freely.
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
