import type { ScenarioModelParametersFailureReason } from "@langwatch/scenario-contract";

/**
 * Prefetch failures a customer can act on (provider off, bad model name,
 * missing credentials, no model chosen) — not our incident. An
 * unrecognised reason stays ours, logged rather than blamed on a guess.
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
