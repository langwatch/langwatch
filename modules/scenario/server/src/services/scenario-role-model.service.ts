/**
 * Which LiteLLM params each scenario agent role runs on. Resolves per-role params
 * with fallback to legacy `modelParams`. See ChildProcessJobDataSchema.
 */

import type { ChildProcessJobData, LiteLLMParams } from "@langwatch/scenario-contract";

/** The model params each non-adapter agent role runs on, fully resolved. */
export interface RoleModelParams {
  simulator: LiteLLMParams;
  judge: LiteLLMParams;
}

/**
 * Resolve user-simulator and judge model params from job payload,
 * falling back to pre-split `modelParams`.
 */
export class ScenarioRoleModelAdapter {
  static create(): ScenarioRoleModelAdapter {
    return new ScenarioRoleModelAdapter();
  }

  private constructor() {}

  static select(
    jobData: Pick<ChildProcessJobData, "modelParams" | "simulatorModelParams" | "judgeModelParams">,
  ): RoleModelParams {
    const simulator = jobData.simulatorModelParams ?? jobData.modelParams;
    const judge = jobData.judgeModelParams ?? jobData.modelParams;

    if (!simulator || !judge) {
      throw new Error(
        "Job payload carries no model params for the user simulator or the judge, and no modelParams to fall back to",
      );
    }

    return { simulator, judge };
  }
}

export const selectRoleModelParams = ScenarioRoleModelAdapter.select;
