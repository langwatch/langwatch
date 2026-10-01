const CONFIG_METADATA_KEYS = new Set(["evaluatorType", "settings"]);

export type EvaluatorSettingsSource =
  | "config-settings"
  | "top-level-recovery"
  | "monitor-parameters";

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
    if (!input.config) {
      return { settings: input.parameters, source: "monitor-parameters" };
    }

    const nested = input.config.settings;
    if (nested && typeof nested === "object" && Object.keys(nested).length > 0) {
      const settings = Object.fromEntries(Object.entries(nested));

      return {
        settings,
        source: "config-settings",
      };
    }

    if (input.recoveryDisabled || input.evaluatorRecordType !== "evaluator") {
      return { settings: input.parameters, source: "monitor-parameters" };
    }

    const recovered = Object.fromEntries(
      Object.entries(input.config).filter(([key]) => !CONFIG_METADATA_KEYS.has(key)),
    );
    if (Object.keys(recovered).length === 0) {
      return { settings: input.parameters, source: "monitor-parameters" };
    }

    return { settings: recovered, source: "top-level-recovery" };
  }
}
