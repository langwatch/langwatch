import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { createProjectApp, requires } from "~/server/api/security";
import { createManyDatasetRecords } from "../../../../server/api/routers/datasetRecord.utils";
import { UploadValidationError } from "../../../../server/datasets/dataset.service";
import type { DatasetColumns } from "../../../../server/datasets/types";
import { datasetColumnTypeSchema } from "../../../../server/datasets/types";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import { resourceLimitMiddleware } from "../../middleware";
import {
  type DatasetServiceMiddlewareVariables,
  datasetServiceMiddleware,
} from "../../middleware/dataset-service";
import { baseResponses } from "../../shared/base-responses";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnprocessableEntityError,
} from "../../shared/errors";
import { platformUrl } from "../../shared/platform-url";
import { errorSchema } from "../../shared/schemas";
import { MAX_LIMIT_MB } from "./constants";
import { handleDatasetError } from "./error-handler";
import { datasetOutputSchema } from "./schemas";
import { buildStandardSuccessResponse } from "./utils";

patchZodOpenapi();

// -- Validation schemas for new endpoints --

const columnTypeSchema = z.object({
  name: z.string(),
  type: datasetColumnTypeSchema,
});

const createDatasetSchema = z.object({
  name: z.string().min(1, "name is required"),
  columnTypes: z.array(columnTypeSchema).optional().default([]),
});

const updateDatasetSchema = z.object({
  name: z.string().min(1).optional(),
  columnTypes: z.array(columnTypeSchema).optional(),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const updateRecordSchema = z.object({
  entry: z.record(z.string(), z.any()),
});

const deleteRecordsSchema = z.object({
  recordIds: z
    .array(z.string())
    .min(1, "recordIds is required")
    .max(1000, "Maximum 1000 records per batch delete"),
});

const batchCreateRecordsSchema = z.object({
  entries: z
    .array(z.record(z.string(), z.any()))
    .min(1, "entries is required")
    .max(1000, "Maximum batch size is 1000 entries"),
});

/**
 * Validation hook that returns 422 instead of the default 400 for Zod validation errors.
 * Used on endpoints where the feature spec requires 422 Unprocessable Entity.
 */
function validationHook(
  result: {
    success: boolean;
    error?: { issues: Array<{ message?: string; path?: (string | number)[] }> };
  },
  c: { json: (body: unknown, status: number) => Response },
): Response | undefined {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    return c.json(
      {
        error: "Unprocessable Entity",
        message: issue?.message ?? "Validation failed",
        path: issue?.path,
      },
      422,
    );
  }
  return undefined;
}

/**
 * Maps DatasetNotFoundError from the service layer to the HTTP NotFoundError.
 * The service throws domain errors; the route handler translates them to HTTP errors.
 */
function mapDatasetNotFoundError(error: unknown): never {
  if (error instanceof Error && error.name === "DatasetNotFoundError") {
    throw new NotFoundError("Dataset not found");
  }
  throw error;
}

const secured = createProjectApp<DatasetServiceMiddlewareVariables>({
  basePath: "/api/dataset",
});

// Preserve the dataset-specific error mapping (domain errors → HTTP codes).
secured.hono.onError(handleDatasetError);

// datasetServiceMiddleware runs AFTER the access chain (which authenticates and
// sets `project`), so it is applied per-route rather than app-wide.

// ── List Datasets (paginated) ──────────────────────────────────
secured.access(requires("datasets:view")).get(
  "/",
  datasetServiceMiddleware,
  describeRoute({
    description: "List all non-archived datasets for the project (paginated)",
  }),
  zValidator("query", paginationQuerySchema),
  async (c) => {
    const project = c.get("project");
    const { page, limit } = c.req.valid("query");
    const service = c.get("datasetService");

    const result = await service.listDatasets({
      projectId: project.id,
      page,
      limit,
    });

    return c.json({
      ...result,
      data: result.data.map((d: { id: string; slug?: string }) => ({
        ...d,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/datasets/${d.id}`,
        }),
      })),
    });
  },
);

// ── Create Dataset ─────────────────────────────────────────────
secured.access(requires("datasets:manage")).post(
  "/",
  datasetServiceMiddleware,
  describeRoute({
    description: "Create a new dataset",
  }),
  resourceLimitMiddleware("datasets"),
  zValidator("json", createDatasetSchema, validationHook),
  async (c) => {
    const project = c.get("project");
    const { name, columnTypes } = c.req.valid("json");
    const service = c.get("datasetService");

    try {
      const dataset = await service.upsertDataset({
        projectId: project.id,
        name,
        columnTypes,
      });

      return c.json(
        {
          id: dataset.id,
          name: dataset.name,
          slug: dataset.slug,
          columnTypes: dataset.columnTypes,
          createdAt: dataset.createdAt,
          updatedAt: dataset.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/datasets/${dataset.id}`,
          }),
        },
        201,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "DatasetConflictError") {
        return c.json(
          {
            error: "Conflict",
            message: "A dataset with this slug already exists",
          },
          409,
        );
      }
      throw error;
    }
  },
);

// ── Create + Upload Dataset from File ─────────────────────────
// IMPORTANT: This route MUST be registered BEFORE /:slugOrId routes
// so Hono doesn't match "upload" as a slugOrId parameter.
secured.access(requires("datasets:manage")).post(
  "/upload",
  datasetServiceMiddleware,
  describeRoute({
    description:
      "Create a new dataset from an uploaded file (CSV, JSON, JSONL)",
  }),
  resourceLimitMiddleware("datasets"),
  async (c) => {
    const project = c.get("project");
    const service = c.get("datasetService");

    const body = await c.req.parseBody();
    const file = body["file"];
    const name = body["name"];

    if (!name || typeof name !== "string" || name.trim() === "") {
      throw new UnprocessableEntityError("name field is required");
    }

    if (!file || !(file instanceof File)) {
      throw new UnprocessableEntityError("file field is required");
    }

    const content = await file.text();

    try {
      const result = await service.createDatasetFromUpload({
        projectId: project.id,
        name: name.trim(),
        filename: file.name,
        content,
        fileSize: file.size,
      });

      return c.json(result, 201);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        if (
          error.kind === "file_too_large" ||
          error.kind === "row_limit_exceeded"
        ) {
          throw new BadRequestError(error.message);
        }
        throw new UnprocessableEntityError(error.message);
      }
      if (error instanceof Error && error.name === "DatasetConflictError") {
        return c.json(
          {
            error: "Conflict",
            message: "A dataset with this slug already exists",
          },
          409,
        );
      }
      // Unsupported format from detectFileFormat
      if (
        error instanceof Error &&
        error.message.includes("Unsupported file format")
      ) {
        throw new UnprocessableEntityError(error.message);
      }
      throw error;
    }
  },
);

// ── Direct (browser→S3) upload: request a presigned PUT ─────────
// Registered before /:slugOrId so "direct-upload" isn't matched as a slug.
secured.access(requires("datasets:manage")).post(
  "/direct-upload",
  datasetServiceMiddleware,
  describeRoute({
    description:
      "Start a direct browser→S3 dataset upload (returns a presigned PUT)",
  }),
  resourceLimitMiddleware("datasets"),
  async (c) => {
    const project = c.get("project");
    const service = c.get("datasetService");

    const body = await c.req.parseBody();
    const name = body.name;
    if (!name || typeof name !== "string" || name.trim() === "") {
      throw new UnprocessableEntityError("name field is required");
    }
    // M1: required — the staged object carries no original filename, so the
    // normalize job depends on this to detect the file format.
    const filename = body.filename;
    if (!filename || typeof filename !== "string" || filename.trim() === "") {
      throw new UnprocessableEntityError("filename field is required");
    }

    try {
      const result = await service.createPendingUpload({
        projectId: project.id,
        name: name.trim(),
        filename: filename.trim(),
      });
      return c.json(result, 201);
    } catch (error) {
      // Self-hosted without browser-reachable S3 → client falls back to /upload.
      if (
        error instanceof Error &&
        error.name === "DirectUploadUnavailableError"
      ) {
        return c.json(
          { error: "DirectUploadUnavailable", message: error.message },
          409,
        );
      }
      if (error instanceof Error && error.name === "DatasetConflictError") {
        return c.json(
          {
            error: "Conflict",
            message: "A dataset with this slug already exists",
          },
          409,
        );
      }
      throw error;
    }
  },
);

// ── Direct upload: finalize after the browser has PUT the file ───
secured.access(requires("datasets:manage")).post(
  "/direct-upload/:datasetId/finalize",
  datasetServiceMiddleware,
  describeRoute({
    description: "Finalize a direct upload: size-check and start processing",
  }),
  async (c) => {
    const { datasetId } = c.req.param();
    const project = c.get("project");
    const service = c.get("datasetService");

    // The staging key is the server-minted one bound to the row (C1); the
    // client no longer supplies it.
    try {
      const result = await service.finalizeUpload({
        projectId: project.id,
        datasetId,
      });
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof Error && error.name === "UploadTooLargeError") {
        throw new BadRequestError(error.message);
      }
      if (error instanceof Error && error.name === "UploadNotPendingError") {
        return c.json({ error: "Conflict", message: error.message }, 409);
      }
      if (
        error instanceof Error &&
        error.name === "StagedUploadNotFoundError"
      ) {
        return c.json({ error: "UploadNotFound", message: error.message }, 422);
      }
      if (error instanceof Error && error.name === "DatasetNotFoundError") {
        return c.json({ error: "NotFound", message: error.message }, 404);
      }
      throw error;
    }
  },
);

// ── Direct upload: manually retry a failed/stuck normalize (I-RECOVER) ──
secured.access(requires("datasets:manage")).post(
  "/direct-upload/:datasetId/retry",
  datasetServiceMiddleware,
  describeRoute({
    description: "Retry normalization of a failed or stuck dataset",
  }),
  async (c) => {
    const { datasetId } = c.req.param();
    const project = c.get("project");
    const service = c.get("datasetService");

    try {
      const result = await service.retryNormalize({
        projectId: project.id,
        datasetId,
      });
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof Error && error.name === "DatasetNotFoundError") {
        return c.json({ error: "NotFound", message: error.message }, 404);
      }
      if (error instanceof Error && error.name === "DatasetNotRetryableError") {
        return c.json({ error: "Conflict", message: error.message }, 409);
      }
      throw error;
    }
  },
);

// ── Upload File to Existing Dataset ─────────────────────────────
secured.access(requires("datasets:manage")).post(
  "/:slugOrId/upload",
  datasetServiceMiddleware,
  describeRoute({
    description: "Upload a file (CSV, JSON, JSONL) to an existing dataset",
  }),
  async (c) => {
    const { slugOrId } = c.req.param();
    const project = c.get("project");
    const service = c.get("datasetService");

    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
      throw new UnprocessableEntityError("file field is required");
    }

    const content = await file.text();

    try {
      const result = await service.uploadToExistingDataset({
        slugOrId,
        projectId: project.id,
        filename: file.name,
        content,
        fileSize: file.size,
      });

      return c.json(result);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        if (
          error.kind === "file_too_large" ||
          error.kind === "row_limit_exceeded" ||
          error.kind === "column_mismatch"
        ) {
          throw new BadRequestError(error.message);
        }
        if (
          error.kind === "empty_file" ||
          error.kind === "unsupported_format"
        ) {
          throw new UnprocessableEntityError(error.message);
        }
        throw new UnprocessableEntityError(error.message);
      }
      if (error instanceof Error && error.name === "DatasetNotFoundError") {
        throw new NotFoundError("Dataset not found");
      }
      // Unsupported format from detectFileFormat
      if (
        error instanceof Error &&
        error.message.includes("Unsupported file format")
      ) {
        throw new UnprocessableEntityError(error.message);
      }
      throw error;
    }
  },
);

// ── Batch Create Records ──────────────────────────────────────
secured.access(requires("datasets:manage")).post(
  "/:slugOrId/records",
  datasetServiceMiddleware,
  describeRoute({
    description: "Create records in a dataset in batch",
  }),
  zValidator("json", batchCreateRecordsSchema, validationHook),
  async (c) => {
    const { slugOrId } = c.req.param();
    const project = c.get("project");
    const { entries } = c.req.valid("json");
    const service = c.get("datasetService");

    try {
      const records = await service.batchCreateRecords({
        slugOrId,
        projectId: project.id,
        entries,
      });

      return c.json({ data: records }, 201);
    } catch (error) {
      if (error instanceof Error && error.name === "InvalidColumnError") {
        throw new BadRequestError(error.message);
      }
      if (
        error instanceof Error &&
        error.name === "MalformedColumnTypesError"
      ) {
        throw new InternalServerError(error.message);
      }
      return mapDatasetNotFoundError(error);
    }
  },
);

// ── Legacy: Add Entries ────────────────────────────────────────
secured.access(requires("datasets:manage")).post(
  "/:slug/entries",
  datasetServiceMiddleware,
  describeRoute({
    description: "Add entries to a dataset",
  }),
  zValidator(
    "json",
    z
      .object({
        entries: z
          .array(z.record(z.string(), z.any()))
          // @ts-ignore
          .openapi({
            example: [
              {
                input: "hi",
                output: "Hello, how can I help you today?",
              },
            ],
          }),
      })
      // @ts-ignore
      .openapi({ ref: "DatasetPostEntries" }),
  ),
  async (c) => {
    const { slug } = c.req.param();
    const project = c.get("project");
    const { entries } = c.req.valid("json");
    const service = c.get("datasetService");

    let dataset;
    try {
      dataset = await service.getBySlugOrId({
        slugOrId: slug,
        projectId: project.id,
      });
    } catch (error) {
      return mapDatasetNotFoundError(error);
    }

    const columns = Object.fromEntries(
      (dataset.columnTypes as DatasetColumns).map((column) => [
        column.name,
        column.type,
      ]),
    );
    for (const entry of entries) {
      for (const [key] of Object.entries(entry)) {
        if (!columns[key]) {
          throw new BadRequestError(
            `Column \`${key}\` is not present in the \`${dataset.name}\` dataset`,
          );
        }
      }
    }

    const now = Date.now();

    await createManyDatasetRecords({
      datasetId: dataset.id,
      projectId: project.id,
      datasetRecords: entries.map((entry, index) => ({
        id: `${now}-${index}`,
        ...entry,
      })),
    });

    return c.json({ success: true });
  },
);

// ── Get Single Dataset ─────────────────────────────────────────
secured.access(requires("datasets:view")).get(
  "/:slugOrId",
  datasetServiceMiddleware,
  describeRoute({
    description: "Get a dataset by its slug or id.",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(datasetOutputSchema),
      404: {
        description: "Dataset not found",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const { slugOrId } = c.req.param();
    if (!slugOrId) {
      throw new UnprocessableEntityError("Dataset slug or id is required");
    }

    const project = c.get("project");
    const service = c.get("datasetService");

    let result;
    try {
      result = await service.getDatasetWithRecords({
        slugOrId,
        projectId: project.id,
        limitMb: MAX_LIMIT_MB,
      });
    } catch (error) {
      return mapDatasetNotFoundError(error);
    }

    const { dataset, records, truncated } = result;
    if (truncated) {
      throw new BadRequestError(`Dataset size exceeds ${MAX_LIMIT_MB}MB limit`);
    }

    return c.json({
      id: dataset.id,
      name: dataset.name,
      slug: dataset.slug,
      columnTypes: dataset.columnTypes,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt,
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/datasets/${dataset.id}`,
      }),
      data: records,
    });
  },
);

// ── Update Dataset ─────────────────────────────────────────────
secured.access(requires("datasets:manage")).patch(
  "/:slugOrId",
  datasetServiceMiddleware,
  describeRoute({
    description: "Update a dataset by its slug or id",
  }),
  zValidator("json", updateDatasetSchema),
  async (c) => {
    const { slugOrId } = c.req.param();
    const project = c.get("project");
    const body = c.req.valid("json");
    const service = c.get("datasetService");

    let dataset;
    try {
      dataset = await service.getBySlugOrId({
        slugOrId,
        projectId: project.id,
      });
    } catch (error) {
      return mapDatasetNotFoundError(error);
    }

    try {
      const updated = await service.upsertDataset({
        projectId: project.id,
        datasetId: dataset.id,
        name: body.name ?? dataset.name,
        columnTypes:
          (body.columnTypes as DatasetColumns) ??
          (dataset.columnTypes as DatasetColumns),
      });

      return c.json({
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        columnTypes: updated.columnTypes,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/datasets/${updated.id}`,
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "DatasetConflictError") {
        return c.json(
          {
            error: "Conflict",
            message: "A dataset with this slug already exists",
          },
          409,
        );
      }
      if (error instanceof Error && error.name === "DatasetNotFoundError") {
        throw new NotFoundError("Dataset not found");
      }
      throw error;
    }
  },
);

// ── Delete (Archive) Dataset ───────────────────────────────────
secured.access(requires("datasets:manage")).delete(
  "/:slugOrId",
  datasetServiceMiddleware,
  describeRoute({
    description: "Archive a dataset (soft-delete)",
  }),
  async (c) => {
    const { slugOrId } = c.req.param();
    const project = c.get("project");
    const service = c.get("datasetService");

    try {
      const result = await service.archiveDataset({
        slugOrId,
        projectId: project.id,
      });
      return c.json(result);
    } catch (error) {
      return mapDatasetNotFoundError(error);
    }
  },
);

// ── List Records (paginated) ───────────────────────────────────
secured.access(requires("datasets:view")).get(
  "/:slugOrId/records",
  datasetServiceMiddleware,
  describeRoute({
    description: "List records for a dataset (paginated)",
  }),
  zValidator("query", paginationQuerySchema),
  async (c) => {
    const { slugOrId } = c.req.param();
    const project = c.get("project");
    const { page, limit } = c.req.valid("query");
    const service = c.get("datasetService");

    try {
      const result = await service.listRecords({
        slugOrId,
        projectId: project.id,
        page,
        limit,
      });
      return c.json(result);
    } catch (error) {
      return mapDatasetNotFoundError(error);
    }
  },
);

// ── Update / Upsert Record ─────────────────────────────────────
secured.access(requires("datasets:manage")).patch(
  "/:slugOrId/records/:recordId",
  datasetServiceMiddleware,
  describeRoute({
    description: "Update or create a record in a dataset",
  }),
  zValidator("json", updateRecordSchema),
  async (c) => {
    const { slugOrId, recordId } = c.req.param();
    const project = c.get("project");
    const { entry } = c.req.valid("json");
    const service = c.get("datasetService");

    try {
      const { record, created } = await service.upsertRecord({
        slugOrId,
        projectId: project.id,
        recordId,
        entry,
      });

      return c.json(record, created ? 201 : 200);
    } catch (error) {
      return mapDatasetNotFoundError(error);
    }
  },
);

// ── Batch Delete Records ───────────────────────────────────────
secured.access(requires("datasets:manage")).delete(
  "/:slugOrId/records",
  datasetServiceMiddleware,
  describeRoute({
    description: "Delete records from a dataset by IDs",
  }),
  zValidator("json", deleteRecordsSchema, validationHook),
  async (c) => {
    const { slugOrId } = c.req.param();
    const project = c.get("project");
    const { recordIds } = c.req.valid("json");
    const service = c.get("datasetService");

    let result;
    try {
      result = await service.deleteRecords({
        slugOrId,
        projectId: project.id,
        recordIds,
      });
    } catch (error) {
      return mapDatasetNotFoundError(error);
    }

    if (result.count === 0) {
      throw new NotFoundError("No matching records found");
    }

    return c.json({ deletedCount: result.count });
  },
);

export const app = secured.hono;
