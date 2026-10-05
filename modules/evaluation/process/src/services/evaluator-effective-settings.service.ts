import type {
  EvaluatorEffectiveSettings,
  EvaluatorEffectiveSettingsQuery,
} from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";

import type { EvaluationSettingsRecoverySwitchService } from "./evaluation-settings-recovery-switch.service.ts";
import type { EvaluatorSettingsService } from "./evaluator-settings.service.ts";

const logger = createLogger("langwatch:evaluation:effective-settings");

/** The settings a run would hand the judge, resolved with the operator's live rollback switch. */
export class EvaluatorEffectiveSettingsService {
  static create(deps: {
    settings: Pick<EvaluatorSettingsService, "resolve">;
    recovery: Pick<EvaluationSettingsRecoverySwitchService, "isDisabled">;
  }): EvaluatorEffectiveSettingsService {
    return new EvaluatorEffectiveSettingsService(deps);
  }

  private constructor(
    private readonly deps: {
      settings: Pick<EvaluatorSettingsService, "resolve">;
      recovery: Pick<EvaluationSettingsRecoverySwitchService, "isDisabled">;
    },
  ) {}

  async get(input: EvaluatorEffectiveSettingsQuery): Promise<EvaluatorEffectiveSettings> {
    return this.deps.settings.resolve({
      config:
        input.config !== null && typeof input.config === "object" && !Array.isArray(input.config)
          ? input.config
          : null,
      parameters: input.parameters,
      evaluatorRecordType: input.evaluatorRecordType,
      recoveryDisabled: await this.readRecoveryDisabled(),
    });
  }

  /** An unreadable switch leaves recovery active, as the runner does. */
  private async readRecoveryDisabled(): Promise<boolean> {
    try {
      return await this.deps.recovery.isDisabled();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Settings-recovery rollback flag could not be read — leaving recovery active",
      );

      return false;
    }
  }
}
