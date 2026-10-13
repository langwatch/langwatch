/**
 * The server half of `batchRecord.*`: the two rollups an experiment's batch-evaluation
 * runs are summarised by. Workflow read access governs both, as on main.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { batchRecordTrpc, ExperimentApi } from "@langwatch/experiment-contract";

export const batchRecordTrpcTransport: TrpcRouterDeclaration<
  ExperimentApi,
  typeof batchRecordTrpc
> = defineTrpcRouter(ExperimentApi, batchRecordTrpc)
  .procedure("getAllByexperimentIdGroup")
  .withPermission("workflows:view")
  .handle(async ({ app, input }) => app.summariseBatchEvaluations({ projectId: input.projectId }))

  .procedure("getAllByexperimentSlug")
  .withPermission("workflows:view")
  .handle(async ({ app, input }) =>
    app.listBatchEvaluations({ projectId: input.projectId, experimentSlug: input.experimentSlug }),
  )
  .build();
