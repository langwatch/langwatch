import { defineServerModule } from "@langwatch/runtime-composition";
import { EvaluatorApp } from "./app/evaluator.app.ts";
import { evaluatorRepositories } from "./repositories/evaluator-repositories.registry.ts";
import { evaluatorTrpcTransport } from "./transport/evaluator.trpc.ts";

export const evaluatorServer = defineServerModule("evaluator")
  .withRepositories(evaluatorRepositories)
  .withApp(EvaluatorApp)
  .withTransports(evaluatorTrpcTransport)
  .build();
