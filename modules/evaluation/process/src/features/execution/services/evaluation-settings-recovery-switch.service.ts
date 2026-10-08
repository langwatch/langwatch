import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

/** The operator's kill switch for recovering an evaluator's settings from its saved row. */
export class EvaluationSettingsRecoverySwitchService {
  static create(flags: Pick<FeatureFlagApi, "isEnabled">): EvaluationSettingsRecoverySwitchService {
    return new EvaluationSettingsRecoverySwitchService(flags);
  }

  private constructor(private readonly flags: Pick<FeatureFlagApi, "isEnabled">) {}

  isDisabled(): Promise<boolean> {
    return this.flags.isEnabled("ops_evaluator_settings_recovery_disabled", { kind: "system" });
  }
}
