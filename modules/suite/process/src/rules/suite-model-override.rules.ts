import { assertNotInstantEvalJudgeModel } from "@langwatch/instant-eval-judge-contract";

/** A suite's model overrides run scenarios, which Instant Evals does not answer. */
export function assertNoInstantEvalOverride(models: {
  simulatorModel?: string | null;
  judgeModel?: string | null;
}): void {
  assertNotInstantEvalJudgeModel({ model: models.simulatorModel });
  assertNotInstantEvalJudgeModel({ model: models.judgeModel });
}
