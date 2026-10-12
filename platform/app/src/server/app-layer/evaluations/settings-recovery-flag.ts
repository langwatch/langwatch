import { featureFlagService } from "~/server/featureFlag";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";

/**
 * The emergency operator rollback for the langwatch#6397 settings recovery
 * (`ops_evaluator_settings_recovery_disabled`). One reader for the runner and
 * for the monitors API, so the API's view of which settings run never drifts
 * from what the runner does.
 *
 * A pipeline-wide switch, flipped for the fleet and not per tenant. Callers
 * treat a rejection as "not disabled": an unreadable kill switch must not fail
 * evaluations or writes.
 */
export function isEvaluatorSettingsRecoveryDisabled(): Promise<boolean> {
  return featureFlagService.isEnabled(
    "ops_evaluator_settings_recovery_disabled",
    {
      distinctId: "evaluator-settings-recovery",
      defaultValue: false,
      projectId: NOT_TARGETED,
      organizationId: NOT_TARGETED,
    },
  );
}
