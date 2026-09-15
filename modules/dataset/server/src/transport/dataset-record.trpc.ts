/**
 * The server half of `datasetRecord.*`: a permission and a handler per
 * procedure the contract already named.
 *
 * Spec: modules/dataset/specs/dataset-service.feature.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  DatasetApi,
  DatasetNotFoundError,
  datasetRecordTrpc,
} from "@langwatch/dataset-contract";

/**
 * The editor loads into the browser, so it asks for a wider window than the
 * 5 MB default (~3 rows of base64 images). A byte budget is what THIS door
 * asks for, not a fact about the dataset, which is why it stays here rather
 * than on the application both doors share.
 */
const DATASET_EDITOR_READ_LIMIT_MB = 13;

export const datasetRecordTrpcTransport = defineTrpcRouter(DatasetApi, datasetRecordTrpc)
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

  .procedure("getAll")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => {
    const result = await app.getDatasetWithRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      limitMb: DATASET_EDITOR_READ_LIMIT_MB,
    });

    return { ...result.dataset, datasetRecords: result.records, truncated: result.truncated };
  })

  .procedure("listPaginated")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => {
    try {
      return await app.getDatasetPage({
        slugOrId: input.datasetId,
        projectId: input.projectId,
        page: input.page,
        limit: input.limit,
      });
    } catch (error) {
      // Parity with getAll: an archived or missing dataset reads as null, so
      // the editor surfaces "no longer available" rather than a failure.
      if (error instanceof DatasetNotFoundError) return null;
      throw error;
    }
  })

  .procedure("download")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => {
    const result = await app.getDatasetWithRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      limitMb: null,
    });

    return { ...result.dataset, datasetRecords: result.records, truncated: result.truncated };
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
