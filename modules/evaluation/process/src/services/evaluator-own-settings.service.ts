import type {
  EvaluatorOwnSettings,
  EvaluatorOwnSettingsQuery,
} from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { createLogger } from "@langwatch/observability";

import type { EvaluationSettingsRecoverySwitchService } from "./evaluation-settings-recovery-switch.service.ts";
import type { EvaluatorSettingsService } from "./evaluator-settings.service.ts";

const logger = createLogger("langwatch:evaluation:evaluator-own-settings");

/**
 * Which settings an evaluator runs with whatever a monitor's parameters say.
 * Resolved by the runner's own resolver and rollback switch, so the answer
 * never drifts from what a run does.
 */
export class EvaluatorOwnSettingsService {
  static create(deps: {
    evaluators: Pick<EvaluatorApi, "getById">;
    settings: EvaluatorSettingsService;
    settingsRecovery: Pick<EvaluationSettingsRecoverySwitchService, "isDisabled">;
  }): EvaluatorOwnSettingsService {
    return new EvaluatorOwnSettingsService(deps);
  }

  private constructor(
    private readonly deps: {
      evaluators: Pick<EvaluatorApi, "getById">;
      settings: EvaluatorSettingsService;
      settingsRecovery: Pick<EvaluationSettingsRecoverySwitchService, "isDisabled">;
    },
  ) {}

  async find(input: EvaluatorOwnSettingsQuery): Promise<EvaluatorOwnSettings> {
    const evaluator = await this.deps.evaluators.getById({
      id: input.evaluatorId,
      projectId: input.projectId,
    });
    const { settings, source } = this.deps.settings.resolve({
      config: isRecord(evaluator.config) ? evaluator.config : null,
      parameters: undefined,
      evaluatorRecordType: evaluator.type,
      recoveryDisabled: await this.readRecoveryDisabled(),
    });

    return source === "monitor-parameters" || !settings
      ? { kind: "none" }
      : { kind: "own", settings };
  }

  /** As in the runner: an unreadable switch leaves recovery active. */
  private async readRecoveryDisabled(): Promise<boolean> {
    try {
      return await this.deps.settingsRecovery.isDisabled();
    } catch (error) {
      // Message only: a client error can carry connection detail on its other properties.
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Settings-recovery rollback flag could not be read, leaving recovery active",
      );

      return false;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
