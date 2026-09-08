/**
 * The server half of `batchRecord.*`: the two rollups an experiment's
 * batch-evaluation runs are summarised by. Both take `workflows:view` — a
 * batch evaluation is a workflow run, and this is the run history of one.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { batchRecordTrpc, DatasetApi } from "@langwatch/dataset-contract";

export const batchRecordTrpcTransport = defineTrpcRouter(DatasetApi, batchRecordTrpc)
  .procedure("getAllByexperimentIdGroup")
  .withPermission("workflows:view")
  .handle(async ({ app, input }) =>
    app.summariseBatchEvaluations({ projectId: input.projectId }),
  )

  .procedure("getAllByexperimentSlug")
  .withPermission("workflows:view")
  .handle(async ({ app, input }) =>
    app.listBatchEvaluations({
      projectId: input.projectId,
      experimentSlug: input.experimentSlug,
    }),
  )
  .build();
