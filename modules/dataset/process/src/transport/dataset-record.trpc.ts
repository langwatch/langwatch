/**
 * The server half of `datasetRecord.*`: a permission and a handler per
 * procedure the contract already named.
 * Spec: modules/dataset/specs/dataset-service.feature.
 */

import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { DatasetApi, datasetRecordTrpc } from "@langwatch/dataset-contract";

export const datasetRecordTrpcTransport: TrpcRouterDeclaration<
  DatasetApi,
  typeof datasetRecordTrpc
> = defineTrpcRouter(DatasetApi, datasetRecordTrpc)
  .procedure("create")
  .withPermission("datasets:create")
  .handle(async ({ app, input }) =>
    app.batchCreateRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      entries: input.entries,
    }),
  )

  .procedure("update")
  .withPermission("datasets:update")
  .handle(async ({ app, input }) =>
    app.upsertRecord({
      recordId: input.recordId,
      updatedRecord: input.updatedRecord,
      slugOrId: input.datasetId,
      projectId: input.projectId,
    }),
  )

  // No budget is named: the read is held to what the organization answers
  // inline in one response, and says how many rows it carries out of how many.
  .procedure("getAll")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => {
    const result = await app.getDatasetWithRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
    });

    return {
      ...result.dataset,
      datasetRecords: result.records,
      truncated: result.truncated,
      loadedRows: result.records.length,
      totalRows: result.totalRows ?? result.records.length,
    };
  })

  .procedure("listPaginated")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) =>
    app.findDatasetPage({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      page: input.page,
      limit: input.limit,
      search: input.search,
    }),
  )

  .procedure("download")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => {
    const result = await app.getDatasetWithRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      limitMb: null,
    });

    return {
      ...result.dataset,
      datasetRecords: result.records,
      truncated: result.truncated,
      loadedRows: result.records.length,
      totalRows: result.totalRows ?? result.records.length,
    };
  })

  .procedure("getHead")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => {
    const result = await app.getDatasetHead({
      slugOrId: input.datasetId,
      projectId: input.projectId,
    });

    return {
      dataset: { ...result.dataset, datasetRecords: result.records },
      total: result.total,
    };
  })

  .procedure("deleteMany")
  .withPermission("datasets:delete")
  .handle(async ({ app, input }) =>
    app.deleteRecords({
      recordIds: input.recordIds,
      slugOrId: input.datasetId,
      projectId: input.projectId,
    }),
  )
  .build();
