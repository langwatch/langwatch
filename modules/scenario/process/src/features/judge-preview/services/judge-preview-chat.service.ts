/**
 * One call of the scenario judge on LangWatch Judge (preview): the judge's chat request becomes a
 * judge-leaf call and its answer the tool call the judge asked for. It throws a named error where
 * the judge may not or cannot answer, so the run ends as an error, never on an invented verdict.
 * @see modules/scenario/specs/judge-preview.feature
 */
import type {
  InstantEvalJudgeApi,
  InstantEvalScenarioJudgeAnswer,
} from "@langwatch/instant-eval-judge-contract";
import {
  JudgePreviewBudgetExhaustedError,
  JudgePreviewNotAvailableError,
  JudgePreviewUnavailableError,
  type JudgePreviewChatCompletion,
  type JudgePreviewChatInput,
} from "@langwatch/scenario-contract";
import type { Instant } from "@langwatch/time";

import {
  judgePreviewChatCompletionOf,
  judgePreviewLeafCallOf,
} from "../../../rules/judge-preview-chat.rules.ts";
import {
  JUDGE_PREVIEW_NOT_ON_CLOUD,
  type JudgePreviewAvailabilityService,
} from "./judge-preview-availability.service.ts";

const PROJECT_NOT_LEARNED =
  "LangWatch Judge (preview) has not learned this project yet, so it judged nothing. Run it again in a minute.";

type JudgePreviewChatServiceDeps = Readonly<{
  judges: Pick<InstantEvalJudgeApi, "judgeScenario">;
  availability: JudgePreviewAvailabilityService;
  ids: { next(): string };
  clock: { now(): Instant };
}>;

export class JudgePreviewChatService {
  static create(deps: JudgePreviewChatServiceDeps): JudgePreviewChatService {
    return new JudgePreviewChatService(deps);
  }

  private constructor(private readonly deps: JudgePreviewChatServiceDeps) {}

  async complete({
    projectId,
    request,
  }: JudgePreviewChatInput): Promise<JudgePreviewChatCompletion> {
    const call = judgePreviewLeafCallOf(request);
    const availability = await this.deps.availability.availabilityFor({ projectId });
    if (!availability.isAvailable) throw new JudgePreviewNotAvailableError(availability.message);
    const answer = await this.deps.judges.judgeScenario({ projectId, ...call });
    return judgePreviewChatCompletionOf({
      answer: judgedOrThrow(answer),
      call,
      id: `chatcmpl_${this.deps.ids.next()}`,
      createdAtSeconds: Math.floor(this.deps.clock.now().epochMilliseconds / 1000),
    });
  }
}

function judgedOrThrow(
  answer: InstantEvalScenarioJudgeAnswer,
): Extract<InstantEvalScenarioJudgeAnswer, { outcome: "judged" }> {
  if (answer.outcome === "judged") return answer;
  if (answer.outcome === "unavailable") throw new JudgePreviewUnavailableError();
  if (answer.code === "instant_eval_free_budget_exhausted") {
    throw new JudgePreviewBudgetExhaustedError(answer.message);
  }
  throw new JudgePreviewNotAvailableError(
    answer.code === "instant_eval_project_unknown"
      ? PROJECT_NOT_LEARNED
      : JUDGE_PREVIEW_NOT_ON_CLOUD,
  );
}
