import type { EvaluationApi, EvaluationServerConfig } from "@langwatch/evaluation-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { EvaluationModule } from "./app/evaluation.app.ts";
import { evaluationLifecycleEventing } from "./eventing/evaluation-lifecycle.pipeline.ts";
import { evaluationProcessingEventing } from "./eventing/evaluation-processing.pipeline.ts";
import { evaluationRepositories } from "./repositories/evaluation-repositories.registry.ts";
import { evaluationTrpcTransport } from "./transport/evaluation.trpc.ts";
import { evaluationsLegacyRest } from "./transport/evaluations-legacy.rest.ts";

export const evaluationProcessModule: PublishedProcessModule<
  "evaluation",
  EvaluationApi,
  EvaluationServerConfig
> = defineProcessModule("evaluation")
  .withRepositories(evaluationRepositories)
  .withApi(EvaluationModule)
  .withTransports(evaluationTrpcTransport, evaluationsLegacyRest)
  .withEventing(evaluationProcessingEventing)
  .withEventing(evaluationLifecycleEventing);
