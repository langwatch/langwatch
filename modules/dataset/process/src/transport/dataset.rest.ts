/** Datasets REST API. Eight doors unimplemented (multipart/streaming/dual-status
 * routes need runtime support).
 */
import {
  BadRequestError,
  defineRestRouter,
  InternalServerError,
  MANAGEMENT_API_VERSION,
  NotFoundError,
  projectRestFacts,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  DatasetApi,
  datasetRestArchivedSchema,
  datasetRestBatchCreateRecordsSchema,
  datasetRestCreateSchema,
  datasetRestDeleteRecordsSchema,
  datasetRestDetailResponseSchema,
  datasetRestEntriesAddedSchema,
  datasetRestLegacyEntriesSchema,
  datasetRestListResponseSchema,
  datasetRestPaginationQuerySchema,
  datasetRestRecordPageSchema,
  datasetRestRecordsCreatedSchema,
  datasetRestRecordsDeletedSchema,
  datasetRestSlugOrIdParamsSchema,
  datasetRestSlugParamsSchema,
  datasetRestSummarySchema,
  datasetRestUpdateSchema,
  type DatasetColumns,
} from "@langwatch/dataset-contract";

/**
 * The read ceiling for `GET /api/dataset/:slugOrId`, which answers with the
 * whole dataset inline. A dataset above it is refused rather than truncated.
 */
const MAX_LIMIT_MB = 25;

/**
 * The two column refusals an append raises, given their HTTP grain here rather
 * than in the family's `onError`: both answer with the application's own
 * sentence in `error`, which the shared domain table cannot express.
 */
function rethrowColumnRefusal(error: unknown): never {
  if (error instanceof Error && error.name === "InvalidColumnError") {
    throw new BadRequestError(error.message);
  }
  if (error instanceof Error && error.name === "MalformedColumnTypesError") {
    throw new InternalServerError(error.message);
  }

  throw error;
}

/** Where a dataset lives in the platform, for the URL every answer carries. */
function datasetUrl(app: DatasetApi, projectSlug: string, datasetId: string): string {
  return app.platformUrl({ projectSlug, path: `/datasets/${datasetId}` });
}

/** The inert declaration the process mounts on its own project-key door. */
export type DatasetRestDeclaration = Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<DatasetApi>;
}>;

export function createDatasetRest(): DatasetRestDeclaration {
  return (
    defineRestRouter(DatasetApi)
      .withNamespace("dataset")
      .withVersion(MANAGEMENT_API_VERSION)

      .get("/", "getApiDataset")
      .withQuery(datasetRestPaginationQuerySchema)
      .withPermission("datasets:view")
      .withMiddleware(projectRestFacts)
      .withOutput(datasetRestListResponseSchema)
      .withDocs({
        description: "List all non-archived datasets for the project (paginated)",
      })
      .handle(async ({ app, input, scope }, project) => {
        const result = await app.listDatasets({
          projectId: scope.id,
          page: input.page,
          limit: input.limit,
        });

        return {
          ...result,
          data: result.data.map((dataset) => ({
            ...dataset,
            platformUrl: datasetUrl(app, project.projectSlug, dataset.id),
          })),
        };
      })

      // Creating asks for `datasets:create`, not `datasets:manage`. `:manage`
      // still implies `:create` through the RBAC hierarchy, so every role and
      // key that could create a dataset yesterday still can.
      .post("/", "postApiDataset")
      .withInput(datasetRestCreateSchema)
      .withPermission("datasets:create")
      .withMiddleware(projectRestFacts)
      .withStatus(201)
      .withOutput(datasetRestSummarySchema)
      .withDocs({ description: "Create a new dataset" })
      .handle(async ({ app, input, scope }, project) => {
        const dataset = await app.upsertDataset({
          projectId: scope.id,
          name: input.name,
          columnTypes: input.columnTypes,
        });

        return {
          id: dataset.id,
          name: dataset.name,
          slug: dataset.slug,
          columnTypes: dataset.columnTypes,
          createdAt: dataset.createdAt,
          updatedAt: dataset.updatedAt,
          platformUrl: datasetUrl(app, project.projectSlug, dataset.id),
        };
      })

      // Rows live inside a dataset; adding them mutates that dataset —
      // `:update`, not `:create`.
      .post("/:slugOrId/records", "postApiDatasetBySlugOrIdRecords")
      .withParams(datasetRestSlugOrIdParamsSchema)
      .withInput(datasetRestBatchCreateRecordsSchema)
      .withPermission("datasets:update")
      .withStatus(201)
      .withOutput(datasetRestRecordsCreatedSchema)
      .withDocs({ description: "Create records in a dataset in batch" })
      .handle(async ({ app, input, scope }) => {
        const records = await app
          .batchCreateRecords({
            slugOrId: input.slugOrId,
            projectId: scope.id,
            entries: input.entries,
          })
          .catch(rethrowColumnRefusal);

        return { data: records };
      })

      // The legacy spelling of the batch-records route above; same grain, and
      // the same application operation, so the two can never disagree.
      .post("/:datasetSlug/entries", "postApiDatasetBySlugEntries")
      .withParams(datasetRestSlugParamsSchema)
      .withInput(datasetRestLegacyEntriesSchema)
      .withPermission("datasets:update")
      .withOutput(datasetRestEntriesAddedSchema)
      .withDocs({ description: "Add entries to a dataset" })
      .handle(async ({ app, input, scope }) => {
        await app
          .batchCreateRecords({
            slugOrId: input.datasetSlug,
            projectId: scope.id,
            entries: input.entries,
          })
          .catch(rethrowColumnRefusal);

        return { success: true as const };
      })

      .get("/:slugOrId", "getApiDatasetBySlugOrId")
      .withParams(datasetRestSlugOrIdParamsSchema)
      .withPermission("datasets:view")
      .withMiddleware(projectRestFacts)
      .withOutput(datasetRestDetailResponseSchema)
      .withDocs({ description: "Get a dataset by its slug or id." })
      .handle(async ({ app, input, scope }, project) => {
        const { dataset, records, truncated } = await app.getDatasetWithRecords({
          slugOrId: input.slugOrId,
          projectId: scope.id,
          limitMb: MAX_LIMIT_MB,
        });

        if (truncated) throw new BadRequestError(`Dataset size exceeds ${MAX_LIMIT_MB}MB limit`);

        return {
          id: dataset.id,
          name: dataset.name,
          slug: dataset.slug,
          columnTypes: dataset.columnTypes,
          createdAt: dataset.createdAt,
          updatedAt: dataset.updatedAt,
          platformUrl: datasetUrl(app, project.projectSlug, dataset.id),
          data: records,
        };
      })

      // `:manage`, not `:update`. A change to the column KEY SET rewrites every
      // record onto the new set, so the shape of the whole dataset follows the
      // payload — that is administering a dataset, which is what `:manage` names.
      .patch("/:slugOrId", "patchApiDatasetBySlugOrId")
      .withParams(datasetRestSlugOrIdParamsSchema)
      .withInput(datasetRestUpdateSchema)
      .withPermission("datasets:manage")
      .withMiddleware(projectRestFacts)
      .withOutput(datasetRestSummarySchema)
      .withDocs({ description: "Update a dataset by its slug or id" })
      .handle(async ({ app, input, scope }, project) => {
        // Naming the dataset by slug is enough: the application resolves it and
        // takes the name and columns this patch did not send from the row it is
        // replacing.
        const updated = await app.upsertDataset({
          projectId: scope.id,
          slugOrId: input.slugOrId,
          name: input.name,
          columnTypes: input.columnTypes as DatasetColumns | undefined,
        });

        return {
          id: updated.id,
          name: updated.name,
          slug: updated.slug,
          columnTypes: updated.columnTypes,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          platformUrl: datasetUrl(app, project.projectSlug, updated.id),
        };
      })

      // Destruction deliberately stays at `:manage` — it is the only grain that
      // carries it, and a read-and-write credential must not inherit it.
      .delete("/:slugOrId", "deleteApiDatasetBySlugOrId")
      .withParams(datasetRestSlugOrIdParamsSchema)
      .withPermission("datasets:manage")
      .withOutput(datasetRestArchivedSchema)
      .withDocs({ description: "Archive a dataset (soft-delete)" })
      .handle(async ({ app, input, scope }) =>
        app.archiveDataset({ slugOrId: input.slugOrId, projectId: scope.id }),
      )

      .get("/:slugOrId/records", "getApiDatasetBySlugOrIdRecords")
      .withParams(datasetRestSlugOrIdParamsSchema)
      .withQuery(datasetRestPaginationQuerySchema)
      .withPermission("datasets:view")
      .withOutput(datasetRestRecordPageSchema)
      .withDocs({ description: "List records for a dataset (paginated)" })
      .handle(async ({ app, input, scope }) =>
        app.listRecords({
          slugOrId: input.slugOrId,
          projectId: scope.id,
          page: input.page,
          limit: input.limit,
        }),
      )

      // Destructive — stays at `:manage`, like the dataset archive above.
      .delete("/:slugOrId/records", "deleteApiDatasetBySlugOrIdRecords")
      .withParams(datasetRestSlugOrIdParamsSchema)
      .withInput(datasetRestDeleteRecordsSchema)
      .withPermission("datasets:manage")
      .withOutput(datasetRestRecordsDeletedSchema)
      .withDocs({ description: "Delete records from a dataset by IDs" })
      .handle(async ({ app, input, scope }) => {
        const result = await app.deleteRecords({
          slugOrId: input.slugOrId,
          projectId: scope.id,
          recordIds: input.recordIds,
        });

        if (result.count === 0) throw new NotFoundError("No matching records found");

        return { deletedCount: result.count };
      })
      .build()
  );
}
