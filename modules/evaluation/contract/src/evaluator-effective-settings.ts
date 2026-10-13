/**
 * Which settings a run hands the judge, as a pure rule both the runner and a
 * monitor's pre-save check read. The caller supplies the operator's rollback switch.
 */
import type { EvaluatorSettingsSource } from "./evaluation.responses.ts";

const CONFIG_METADATA_KEYS = new Set(["evaluatorType", "settings"]);

/** Nested settings win; a saved evaluator's top-level keys are recovered unless switched off. */
export function resolveEvaluatorEffectiveSettings({
  config,
  parameters,
  evaluatorRecordType,
  recoveryDisabled,
}: {
  config: Record<string, unknown> | null | undefined;
  parameters: Record<string, unknown> | null | undefined;
  evaluatorRecordType: string | null | undefined;
  recoveryDisabled?: boolean | undefined;
}): {
  settings: Record<string, unknown> | null | undefined;
  source: EvaluatorSettingsSource;
} {
  if (!config) return { settings: parameters, source: "monitor-parameters" };

  const nested = config.settings;
  if (nested && typeof nested === "object" && Object.keys(nested).length > 0) {
    return { settings: Object.fromEntries(Object.entries(nested)), source: "config-settings" };
  }

  if (recoveryDisabled || evaluatorRecordType !== "evaluator") {
    return { settings: parameters, source: "monitor-parameters" };
  }

  const recovered = Object.fromEntries(
    Object.entries(config).filter(([key]) => !CONFIG_METADATA_KEYS.has(key)),
  );
  if (Object.keys(recovered).length === 0) {
    return { settings: parameters, source: "monitor-parameters" };
  }

  return { settings: recovered, source: "top-level-recovery" };
}
