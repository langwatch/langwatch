import { NoOpLogger } from "../../../../logger";
import { setupObservability } from "../index";

type SetupObservabilityOptions = NonNullable<
  Parameters<typeof setupObservability>[0]
>;

/**
 * Shared setup for observability integration tests.
 *
 * Standardizes the block these suites converged on after #3240: LangWatch
 * export disabled (the tests assert against their own in-memory processors, not
 * the network), setup errors thrown rather than swallowed, and a NoOpLogger so
 * the SDK's own diagnostics stay out of test output. Callers pass the per-suite
 * serviceName and processors; every default here is overridable, and any extra
 * `advanced` flags merge over the thrown-on-error default.
 *
 * Making `langwatch: "disabled"` the default for this class of test keeps new
 * integration tests from repeating the #3240 mistake of hitting the real
 * exporter.
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
