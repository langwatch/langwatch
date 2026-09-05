import type { ScenarioModelParametersFailureReason } from "@langwatch/scenario-contract";

/**
 * The prefetch failures a customer can act on: the provider is off, the model
 * name does not parse, the credentials are missing, or no model was chosen for
 * scenarios at all. Every one of these fails the run correctly and carries the
 * remediation message the customer needs, so they are not our incident.
 *
 * A reason we do not recognise — including none at all — stays ours: telling
 * someone their configuration is broken on the strength of not recognising an
 * error is worse than logging one record too loudly.
 *
 * @see specs/scenarios/execution-blocked-by-configuration.feature
 */
const CUSTOMER_ACTIONABLE_PREFETCH_REASONS = new Set<ScenarioModelParametersFailureReason>([
  "invalid_model_format",
  "provider_not_found",
  "provider_not_enabled",
  "missing_params",
  "model_not_configured",
]);

export function isCustomerActionablePrefetchFailure(
  reason: ScenarioModelParametersFailureReason | undefined,
): boolean {
  return reason !== undefined && CUSTOMER_ACTIONABLE_PREFETCH_REASONS.has(reason);
}
