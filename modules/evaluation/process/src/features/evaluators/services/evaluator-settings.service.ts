import {
  resolveEvaluatorEffectiveSettings,
  type EvaluatorSettingsSource,
} from "@langwatch/evaluation-contract";

export type { EvaluatorSettingsSource };

export class EvaluatorSettingsService {
  static create(): EvaluatorSettingsService {
    return new EvaluatorSettingsService();
  }

  private constructor() {}

  resolve(input: {
    config: Record<string, unknown> | null | undefined;
    parameters: Record<string, unknown> | null | undefined;
    evaluatorRecordType: string | null | undefined;
    recoveryDisabled?: boolean;
  }): {
    settings: Record<string, unknown> | null | undefined;
    source: EvaluatorSettingsSource;
  } {
    return resolveEvaluatorEffectiveSettings(input);
  }
}
