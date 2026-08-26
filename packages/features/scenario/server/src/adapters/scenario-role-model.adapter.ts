/**
 * Which LiteLLM params each scenario agent role runs on.
 *
 * The user-simulator and the judge each carry their own params on the job
 * payload, but both fields are optional on the wire: a job queued before that
 * split was introduced carries a single `modelParams` that drove every agent,
 * and queued jobs straddle a deploy. Resolving that fallback in one place keeps
 * `scenario-child-process.ts` free of per-role `??` chains and makes the
 * selection unit-testable without spawning the child process (issue #6634).
 *
 * @see ChildProcessJobDataSchema — rejects a payload from which a role's
 *   params could not be resolved, so the fallback here always has something to
 *   fall back to.
 */

import type { ChildProcessJobData, LiteLLMParams } from "@langwatch/scenario-contract";

/** The model params each non-adapter agent role runs on, fully resolved. */
export interface RoleModelParams {
  simulator: LiteLLMParams;
  judge: LiteLLMParams;
}

/**
 * Resolve the user-simulator's and judge's model params from a parsed job
 * payload, falling back to the pre-split `modelParams` for any role that
 * carries none of its own.
 *
 * @param jobData - A job payload, normally one already validated by
 *   `ChildProcessJobDataSchema`.
 * @returns The params each role's model is built from.
 * @throws Error when a role has neither its own params nor the legacy
 *   fallback. `ChildProcessJobDataSchema` rejects such a payload at parse, so
 *   this fires only for job data assembled without it.
 */
export class ScenarioRoleModelAdapter {
  static create(): ScenarioRoleModelAdapter {
    return new ScenarioRoleModelAdapter();
  }

  private constructor() {}

  static select(
    jobData: Pick<
      ChildProcessJobData,
      "modelParams" | "simulatorModelParams" | "judgeModelParams"
    >,
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
