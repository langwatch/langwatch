/** Datasets REST API. */
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
  DATASET_ATTACHMENT_MAX_BYTES,
  DATASET_ATTACHMENT_MULTIPART_SLACK_BYTES,
  DATASET_ATTACHMENT_REQUEST_MAX_BYTES,
  DatasetApi,
  DatasetAttachmentTooLargeError,
  datasetRestArchivedSchema,
  datasetRestAttachmentFieldsSchema,
  datasetRestAttachmentQuerySchema,
  datasetRestBatchCreateRecordsSchema,
  datasetRestCreateSchema,
  datasetRestDeleteRecordsSchema,
  datasetRestDetailResponseSchema,
  datasetRestImportSchema,
  datasetRestAppendImportSchema,
  datasetRestNoUploadFieldsSchema,
  datasetRestUploadCreatedSchema,
  datasetRestUploadFieldsSchema,
  datasetImportAppendedSchema,
  datasetImportStartedSchema,
  datasetRestEntriesAddedSchema,
  datasetRestLegacyEntriesSchema,
  datasetRestListResponseSchema,
  datasetRestPaginationQuerySchema,
  datasetRecordSchema,
  datasetRestRecordPageSchema,
  datasetRestRecordParamsSchema,
  datasetRestRecordsCreatedSchema,
  datasetRestRecordsDeletedSchema,
  datasetRestSlugOrIdParamsSchema,
  datasetRestSlugParamsSchema,
  datasetRestSummarySchema,
  datasetRestUpdateRecordSchema,
  datasetRestUpdateSchema,
  MAX_FILE_SIZE_BYTES,
  storedDatasetAttachmentSchema,
  UploadValidationError,
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

/** Main's pace for the attachment route: well above a person filling cells. */
const ATTACHMENT_UPLOADS_PER_MINUTE = 30;

/** Where a dataset attachment's file is uploaded now. */
const STORED_OBJECTS_SUCCESSOR = "/api/v1/stored-objects";

/** Where a dataset is built from an uploaded file now (ADR-158 §8). */
const IMPORTS_SUCCESSOR = "/api/v1/dataset/imports";

/** The deprecated /upload pair's whole-request cap: main's 25 MB file plus multipart framing. */
const UPLOAD_REQUEST_MAX_BYTES = MAX_FILE_SIZE_BYTES + DATASET_ATTACHMENT_MULTIPART_SLACK_BYTES;

const uploadBodyLimit = {
  maxBytes: UPLOAD_REQUEST_MAX_BYTES,
  onExceeded: () =>
    new UploadValidationError("File size exceeds the maximum limit of 25MB", "file_too_large"),
};

const UPLOAD_THEN_IMPORT =
  "upload the file as a stored object with the purpose dataset_import, then create the dataset from it";

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
      .post("/:slug/entries", "postApiDatasetBySlugEntries")
      .withParams(datasetRestSlugParamsSchema)
      .withInput(datasetRestLegacyEntriesSchema)
      .withPermission("datasets:update")
      .withOutput(datasetRestEntriesAddedSchema)
      .withDocs({ description: "Add entries to a dataset" })
      .handle(async ({ app, input, scope }) => {
        await app
          .batchCreateRecords({
            slugOrId: input.slug,
            projectId: scope.id,
            entries: input.entries,
          })
          .catch(rethrowColumnRefusal);

        return { success: true as const };
      })

      // A dataset is built from a confirmed `dataset_import` file; the bytes never
      // pass through here (ADR-158 §6). Preparation runs in the background.
      .post("/imports", "postApiDatasetImports")
      .withInput(datasetRestImportSchema)
      .withPermission("datasets:create")
      .withStatus(201)
      .withOutput(datasetImportStartedSchema)
      .withDocs({ description: "Create a dataset from an uploaded and confirmed file" })
      .handle(({ app, input, scope }) =>
        app.createDatasetFromStoredObject({ ...input, projectId: scope.id }),
      )

      .post("/:slugOrId/imports", "postApiDatasetBySlugOrIdImports")
      .withParams(datasetRestSlugOrIdParamsSchema)
      .withInput(datasetRestAppendImportSchema)
      .withPermission("datasets:update")
      .withOutput(datasetImportAppendedSchema)
      .withDocs({ description: "Add an uploaded and confirmed file's rows to a dataset" })
      .handle(({ app, input, scope }) =>
        app.appendStoredObjectToDataset({ ...input, projectId: scope.id }),
      )

      // Deprecated, time-boxed exception to "no bytes": the Python SDK still posts
      // files here. Both retire in the next release (ADR-158 §8).
      .post("/upload", "postApiDatasetUpload")
      .withMultipart({ fields: datasetRestUploadFieldsSchema, files: { file: { required: true } } })
      .withBodyLimit(uploadBodyLimit)
      .withPermission("datasets:create")
      .withStatus(201)
      .withOutput(datasetRestUploadCreatedSchema)
      .withDeprecated({ successor: IMPORTS_SUCCESSOR, notice: UPLOAD_THEN_IMPORT })
      .withDocs({ description: "Create a new dataset from an uploaded file (CSV, JSON, JSONL)" })
      .handle(({ app, input, files, scope }) =>
        app.createDatasetFromUpload({
          projectId: scope.id,
          name: input.name,
          filename: files.file.name,
          bytes: files.file.stream(),
          fileSize: files.file.size,
        }),
      )

      .post("/:slugOrId/upload", "postApiDatasetBySlugOrIdUpload")
      .withParams(datasetRestSlugOrIdParamsSchema)
      .withMultipart({
        fields: datasetRestNoUploadFieldsSchema,
        files: { file: { required: true } },
      })
      .withBodyLimit(uploadBodyLimit)
      .withPermission("datasets:update")
      .withOutput(datasetImportAppendedSchema)
      .withDeprecated({ successor: IMPORTS_SUCCESSOR, notice: UPLOAD_THEN_IMPORT })
      .withDocs({ description: "Upload a file (CSV, JSON, JSONL) to an existing dataset" })
      .handle(({ app, input, files, scope }) =>
        app.uploadToExistingDataset({
          slugOrId: input.slugOrId,
          projectId: scope.id,
          filename: files.file.name,
          bytes: files.file.stream(),
          fileSize: files.file.size,
        }),
      )

      // Deprecated, the same time-boxed exception as the /upload pair: the posted
      // file is stored as a dataset attachment. Retires in the next release (ADR-158 §8).
      .post("/attachments", "postApiDatasetAttachments")
      .withQuery(datasetRestAttachmentQuerySchema)
      .withMultipart({
        fields: datasetRestAttachmentFieldsSchema,
        files: { file: { required: true } },
      })
      .withBodyLimit({
        maxBytes: DATASET_ATTACHMENT_REQUEST_MAX_BYTES,
        onExceeded: () => new DatasetAttachmentTooLargeError(DATASET_ATTACHMENT_MAX_BYTES),
      })
      .withRateLimit({ requests: ATTACHMENT_UPLOADS_PER_MINUTE, seconds: 60 })
      .withPermission("datasets:manage")
      .withOutput(storedDatasetAttachmentSchema)
      .withDeprecated({
        successor: STORED_OBJECTS_SUCCESSOR,
        notice: "upload the file as a stored object, then put its reference in the cell",
      })
      .withDocs({
        description:
          "Upload a file for an image or file column and get the reference a cell holds. The project is named by the `projectId` query parameter; the file goes in the `file` multipart field, with an optional `datasetId` field.",
      })
      .handle(({ app, input, files, scope }) =>
        app.storeAttachmentUpload({
          projectId: scope.id,
          datasetId: input.datasetId,
          filename: files.file.name,
          mediaType: files.file.type,
          bytes: files.file.stream(),
          fileSize: files.file.size,
        }),
      )

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

      // 201 when the record did not exist yet and was created, 200 when it was updated.
      .patch("/:slugOrId/records/:recordId", "patchApiDatasetBySlugOrIdRecordsByRecordId")
      .withParams(datasetRestRecordParamsSchema)
      .withInput(datasetRestUpdateRecordSchema)
      .withPermission("datasets:update")
      .responds({ 200: datasetRecordSchema, 201: datasetRecordSchema })
      .withDocs({ description: "Update or create a record in a dataset" })
      .handle(async ({ app, input, scope }) => {
        const { record, created } = await app.upsertRecord({
          slugOrId: input.slugOrId,
          projectId: scope.id,
          recordId: input.recordId,
          updatedRecord: input.entry,
        });

        return created ? { status: 201, body: record } : { status: 200, body: record };
      })

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
