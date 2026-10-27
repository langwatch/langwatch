/**
 * The server half of `dataset.*`: a permission and a handler per
 * procedure the contract already named. Names, kinds and schemas are
 * not repeated here. Spec: modules/dataset/specs/dataset-service.feature.
 */

import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { DatasetApi, datasetTrpc } from "@langwatch/dataset-contract";

import { datasetAuthorOf } from "../rules/dataset-version-author.rules.ts";

export const datasetTrpcTransport: TrpcRouterDeclaration<DatasetApi, typeof datasetTrpc> =
  defineTrpcRouter(DatasetApi, datasetTrpc)
    .procedure("upsert")
    .withPermission("datasets:manage")
    .handle(async ({ app, input, actor }) =>
      app.upsertDataset({
        projectId: input.projectId,
        name: input.name,
        columnTypes: input.columnTypes,
        datasetId: input.datasetId,
        datasetRecords: input.datasetRecords,
        editedBy: datasetAuthorOf({ actor }),
      }),
    )

    .procedure("validateDatasetName")
    .withPermission("datasets:view")
    .handle(async ({ app, input }) => app.validateDatasetName(input))

    .procedure("getAll")
    .withPermission("datasets:view")
    .handle(({ app, input }) =>
      app.findDatasetSummaries({ projectId: input.projectId, page: 1, limit: 200 }),
    )

    .procedure("recordCounts")
    .withPermission("datasets:view")
    .handle(({ app, input }) => app.countRecords(input))

    .procedure("getById")
    .withPermission("datasets:view")
    .handle(async ({ app, input }) =>
      app.findBySlugOrId({
        projectId: input.projectId,
        slugOrId: input.datasetId,
      }),
    )

    .procedure("deleteById")
    .withPermission("datasets:delete")
    .handle(async ({ app, input }) => app.archiveOrRestoreDataset(input))

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
    // The upload drawer's successor to main's direct-upload, which asked for manage.
    .procedure("createFromStoredObject")
    .withPermission("datasets:manage")
    .handle(({ app, input }) => app.createDatasetFromStoredObject(input))
    .procedure("appendStoredObject")
    .withPermission("datasets:update")
    .handle(({ app, input, actor }) =>
      app.appendStoredObjectToDataset({ ...input, editedBy: datasetAuthorOf({ actor }) }),
    )
    .procedure("getLimits")
    .withPermission("datasets:view")
    .handle(({ app, input }) => app.getLimits({ projectId: input.projectId }))
    .procedure("createAttachmentUpload")
    .withPermission("datasets:update")
    .handle(({ app, input }) => app.createAttachmentUpload(input))
    .procedure("retryNormalize")
    .withPermission("datasets:manage")
    .handle(({ app, input }) => app.retryNormalize(input))
    .procedure("versions")
    .withPermission("datasets:view")
    .handle(({ app, input }) => app.listVersions(input))
    .procedure("saveVersion")
    .withPermission("datasets:update")
    .handle(({ app, input, actor }) =>
      app.saveVersion({ ...input, editedBy: datasetAuthorOf({ actor }) }),
    )
    .procedure("versionPage")
    .withPermission("datasets:view")
    .handle(({ app, input }) => app.getVersionPage(input))
    .procedure("compareVersion")
    .withPermission("datasets:view")
    .handle(({ app, input }) => app.compareVersion(input))
    .procedure("restoreVersion")
    .withPermission("datasets:update")
    .handle(({ app, input, actor }) =>
      app.restoreVersion({ ...input, editedBy: datasetAuthorOf({ actor }) }),
    )
    .procedure("pinVersion")
    .withPermission("datasets:update")
    .handle(({ app, input }) => app.pinVersion(input))
    .procedure("runVersions")
    .withPermission("datasets:view")
    .handle(({ app, input }) => app.findRunVersions(input))
    .build();
