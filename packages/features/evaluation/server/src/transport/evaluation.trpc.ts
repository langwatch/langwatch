/**
 * The server half of `evaluations.*`: a permission and a handler per procedure.
 * Which evaluators this install carries, which credentials a project is missing,
 * and what a re-score reports onto the pipeline are all the application's.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { EvaluationApi, evaluationTrpc } from "@langwatch/evaluation-contract";

export const evaluationTrpcTransport = defineTrpcRouter(EvaluationApi, evaluationTrpc)
  .procedure("availableEvaluators")
  .withPermission("evaluations:view")
  .handle(({ app, input }) => app.listEvaluators(input))

  .procedure("availableCustomEvaluators")
  .withPermission("evaluations:view")
  .handle(({ app, input }) => app.listCustomEvaluators(input))

  .procedure("runEvaluation")
  .withPermission("evaluations:manage")
  .handle(({ app, input, actor }) => app.runTraceEvaluation(input, { id: actor.id }))

  .procedure("warmupLambda")
  .withPermission("evaluations:view")
  .handle(({ app, input }) => app.warmupEvaluators(input))
  .build();
