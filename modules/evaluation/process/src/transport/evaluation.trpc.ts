/**
 * The server half of `evaluations.*`: a permission and a handler per procedure.
 * Which evaluators this install carries, which credentials a project is missing,
 * and what a re-score reports onto the pipeline are all the application's.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { EvaluationApi, evaluationTrpc } from "@langwatch/evaluation-contract";

export const evaluationTrpcTransport: TrpcRouterDeclaration<EvaluationApi, typeof evaluationTrpc> =
  defineTrpcRouter(EvaluationApi, evaluationTrpc)
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

    /**
     * `evaluations:view` for the monitors, and `analytics:view` on top because
     * the trend is the analytics page's own comparison window.
     */
    .procedure("getMonitorPerformanceForProject")
    .withPermission(["evaluations:view", "analytics:view"])
    .handle(({ app, input }) =>
      app.findMonitorPerformance({
        projectId: input.projectId,
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      }),
    )

    // `traces:view`, as on `traces.getEvaluationInputs`: the path moved, not the gate.
    .procedure("getEvaluationInputs")
    .withPermission("traces:view")
    .handle(({ app, input, actor, authorization }) =>
      app.findInputs({
        projectId: input.projectId,
        evaluationId: input.evaluationId,
        ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
        authorization,
        userId: actor.id,
      }),
    )
    .build();
