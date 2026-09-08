import { defineFeature } from "@langwatch/runtime-composition";

import { EvaluationApp } from "./app/evaluation.app.ts";
import { evaluationRepositories } from "./repositories/evaluation-repositories.registry.ts";
import { evaluationTrpcTransport } from "./transport/evaluation.trpc.ts";

export type { EvaluationInfrastructure } from "./app/evaluation.app.ts";

export const evaluationServer = defineFeature("evaluation")
  .withRepositories(evaluationRepositories)
  .withApp(EvaluationApp)
  .withTransports(evaluationTrpcTransport)
  .build();
