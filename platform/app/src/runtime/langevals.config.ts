import { z } from "zod";

const langevalsEnvironmentSchema = z.object({
  LANGEVALS_ENDPOINT: z.string().optional(),
});

/** Immutable process configuration for the Langevals HTTP evaluator transport. */
export type LangevalsRuntimeConfig = Readonly<{
  endpoint: string | undefined;
  maxRetries: number;
  timeoutMs: number;
}>;

const defaultMaxRetries = 1;
const defaultTimeoutMs = 120_000;

/**
 * Reads the validated process environment once, before the application graph
 * is composed. Endpoint syntax and an empty value deliberately retain the
 * legacy semantics: deployments may use an internal hostname, and an empty
 * endpoint leaves the transport unavailable.
 */
export function resolveLangevalsRuntimeConfig(
  source: Readonly<Record<string, unknown>>,
): LangevalsRuntimeConfig {
  const environment = langevalsEnvironmentSchema.parse(source);

  return {
    endpoint: environment.LANGEVALS_ENDPOINT,
    maxRetries: defaultMaxRetries,
    timeoutMs: defaultTimeoutMs,
  };
}
