/**
 * The server half of `batchRecord.*`: the two rollups an experiment's
 * batch-evaluation runs are summarised by. Dataset read access governs both rollups.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { batchRecordTrpc, DatasetApi } from "@langwatch/dataset-contract";

export const batchRecordTrpcTransport = defineTrpcRouter(DatasetApi, batchRecordTrpc)
  .procedure("getAllByexperimentIdGroup")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => app.summariseBatchEvaluations({ projectId: input.projectId }))

  .procedure("getAllByexperimentSlug")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) =>
    app.listBatchEvaluations({
      projectId: input.projectId,
      experimentSlug: input.experimentSlug,
    }),
  )
  .build();
