import { projectRequestContextOf } from "@langwatch/api/rest";
import type { EvaluatorApi, EvaluatorServerConfig } from "@langwatch/evaluator-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { EvaluatorModule } from "./app/evaluator.app.ts";
import { evaluatorLifecycleEventing } from "./eventing/evaluator-lifecycle.pipeline.ts";
import { evaluatorWorkflowArchiveCascadeEventing } from "./eventing/evaluator-workflow-archive-cascade.pipeline.ts";
import { evaluatorRepositories } from "./repositories/evaluator-repositories.registry.ts";
import { createEvaluatorRest } from "./transport/evaluator.rest.ts";
import { evaluatorTrpcTransport } from "./transport/evaluator.trpc.ts";

export const evaluatorProcessModule: PublishedProcessModule<
  "evaluator",
  EvaluatorApi,
  EvaluatorServerConfig
> = defineProcessModule("evaluator")
  .withRepositories(evaluatorRepositories)
  .withApi(EvaluatorModule)
  .withTransports(createEvaluatorRest(), evaluatorTrpcTransport)
  .provideMiddlewareContext({ projectRequestContext: projectRequestContextOf })
  .withEventing(evaluatorLifecycleEventing)
  .withEventing(evaluatorWorkflowArchiveCascadeEventing);
