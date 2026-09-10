import { defineServerModule } from "@langwatch/runtime-composition";

import { EvaluationApp } from "./app/evaluation.app.ts";
import { evaluationRepositories } from "./repositories/evaluation-repositories.registry.ts";
import { evaluationTrpcTransport } from "./transport/evaluation.trpc.ts";
import { evaluationsLegacyRest } from "./transport/evaluations-legacy.rest.ts";

export type { EvaluationInfrastructure } from "./app/evaluation.app.ts";

export const evaluationServer = defineServerModule("evaluation")
  .withRepositories(evaluationRepositories)
  .withApp(EvaluationApp)
  .withTransports(evaluationTrpcTransport, evaluationsLegacyRest)
  .build();
