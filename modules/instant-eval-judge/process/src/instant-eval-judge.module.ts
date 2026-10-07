import { defineProcessModule } from "@langwatch/process";

import { InstantEvalJudgeModule } from "./app/instant-eval-judge.app.ts";
import { instantEvalJudgeFactsEventing } from "./eventing/instant-eval-judge-facts.pipeline.ts";
import { instantEvalJudgeRepositories } from "./repositories/instant-eval-judge-repositories.registry.ts";

export const instantEvalJudgeProcessModule = defineProcessModule("instant-eval-judge")
  .withRepositories(instantEvalJudgeRepositories)
  .withApi(InstantEvalJudgeModule)
  .withEventing(instantEvalJudgeFactsEventing);
