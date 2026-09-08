/**
 * The server half of `dataset.*`: a permission and a handler per procedure the
 * contract already named. Names, kinds and schemas are not repeated here.
 *
 * Spec: packages/features/dataset/specs/dataset-service.feature.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { DatasetApi, DatasetNotFoundError, datasetTrpc } from "@langwatch/dataset-contract";

export const datasetTrpcTransport = defineTrpcRouter(DatasetApi, datasetTrpc)
  .procedure("upsert")
  .withPermission("datasets:manage")
  // Borrowing the experiment's name when the caller named one is the
  // application's rule, not this transport's: the REST patch fills the same
  // hole from the dataset it is replacing, and one upsert decides both.
  .handle(async ({ app, input }) =>
    app.upsertDataset({
      projectId: input.projectId,
      name: "name" in input ? input.name : undefined,
      experimentId: "experimentId" in input ? input.experimentId : undefined,
      columnTypes: input.columnTypes,
      datasetId: "datasetId" in input ? input.datasetId : undefined,
      datasetRecords: input.datasetRecords,
    }),
  )

  .procedure("validateDatasetName")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => app.validateDatasetName(input))

  .procedure("getAll")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => {
    const result = await app.listDatasets({ projectId: input.projectId, page: 1, limit: 200 });

    return result.data;
  })

  .procedure("getById")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => {
    try {
      return await app.getBySlugOrId({
        projectId: input.projectId,
        slugOrId: input.datasetId,
      });
    } catch (error) {
      // An archived or missing dataset reads as an empty selection rather than
      // failing the page that asked for it.
      if (error instanceof DatasetNotFoundError) return null;
      throw error;
    }
  })

  .procedure("deleteById")
  .withPermission("datasets:delete")
  .handle(async ({ app, input }) => {
    if (input.undo) {
      await app.restoreDataset({ datasetId: input.datasetId, projectId: input.projectId });

      return { success: true as const };
    }

    await app.archiveDataset({ slugOrId: input.datasetId, projectId: input.projectId });

    return { success: true as const };
  })

  .procedure("updateMapping")
  .withPermission("datasets:update")
  .handle(async ({ app, input }) => app.updateMapping(input))

  .procedure("findNextName")
  .withPermission("datasets:view")
  .handle(async ({ app, input }) => app.findNextAvailableName(input))

  .procedure("copy")
  .withPermission("datasets:create")
  // The declared check covers `projectId`, the TARGET. The source is a second
  // project the caller also named, and the application probes the caller's
  // reach into it before reading anything from it.
  .handle(async ({ app, input, actor }) =>
    app.copyDatasetForActor({
      actorId: actor.id,
      sourceDatasetId: input.datasetId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.projectId,
    }),
  )
  .build();
