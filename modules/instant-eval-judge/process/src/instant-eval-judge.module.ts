import type {
  InstantEvalJudgeApi,
  InstantEvalJudgeServerConfig,
} from "@langwatch/instant-eval-judge-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { InstantEvalJudgeModule } from "./app/instant-eval-judge.app.ts";
import { instantEvalJudgeFactsEventing } from "./eventing/instant-eval-judge-facts.pipeline.ts";
import { instantEvalJudgeSpendEventing } from "./eventing/instant-eval-judge-spend.pipeline.ts";
import { instantEvalJudgeRepositories } from "./repositories/instant-eval-judge-repositories.registry.ts";

export const instantEvalJudgeProcessModule: PublishedProcessModule<
  "instant-eval-judge",
  InstantEvalJudgeApi,
  InstantEvalJudgeServerConfig
> = defineProcessModule("instant-eval-judge")
  .withRepositories(instantEvalJudgeRepositories)
  .withApi(InstantEvalJudgeModule)
  .withEventing(instantEvalJudgeFactsEventing)
  .withEventing(instantEvalJudgeSpendEventing);
