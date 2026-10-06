import { defineProcessModule } from "@langwatch/process";

import { EvaluatorModule } from "./app/evaluator.app.ts";
import { evaluatorRepositories } from "./repositories/evaluator-repositories.registry.ts";
import { createEvaluatorRest } from "./transport/evaluator.rest.ts";
import { evaluatorTrpcTransport } from "./transport/evaluator.trpc.ts";

export const evaluatorProcessModule = defineProcessModule("evaluator")
  .withRepositories(evaluatorRepositories)
  .withApi(EvaluatorModule)
  .withTransports(createEvaluatorRest(), evaluatorTrpcTransport);
