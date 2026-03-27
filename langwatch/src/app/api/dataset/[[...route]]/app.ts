import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createManyDatasetRecords } from "../../../../server/api/routers/datasetRecord.utils";
import type { DatasetColumns } from "../../../../server/datasets/types";
import { datasetColumnTypeSchema } from "../../../../server/datasets/types";
import {
  DatasetConflictError,
  DatasetNotFoundError,
} from "../../../../server/datasets/errors";
import { DatasetService } from "../../../../server/datasets/dataset.service";
import { prisma } from "../../../../server/db";
import { slugify } from "../../../../utils/slugify";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import {
  type AuthMiddlewareVariables,
  authMiddleware,
  resourceLimitMiddleware,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { baseResponses } from "../../shared/base-responses";
import {
  BadRequestError,
  NotFoundError,
  UnprocessableEntityError,
} from "../../shared/errors";
import { errorSchema } from "../../shared/schemas";
import { MAX_LIMIT_MB } from "./constants";
import { handleDatasetError } from "./error-handler";
import { datasetOutputSchema } from "./schemas";
import { buildStandardSuccessResponse } from "./utils";

patchZodOpenapi();

type Variables = AuthMiddlewareVariables;

const getService = () => DatasetService.create(prisma);

/**
 * Resolves a dataset by slug or id within a project.
 * @throws {NotFoundError} if not found
 */
async function resolveDataset({
  slugOrId,
  projectId,
}: {
  slugOrId: string;
  projectId: string;
}) {
  const dataset = await prisma.dataset.findFirst({
    where: {
      projectId,
      archivedAt: null,
      OR: [{ slug: slugOrId }, { id: slugOrId }],
    },
  });
  if (!dataset) {
    throw new NotFoundError("Dataset not found");
  }
  return dataset;
}

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
  recordIds: z.array(z.string()).min(1, "recordIds is required"),
});

/**
 * Validation hook that returns 422 instead of the default 400 for Zod validation errors.
 * Used on endpoints where the feature spec requires 422 Unprocessable Entity.
 */
function validationHook(result: { success: boolean; error?: { issues: unknown[] } }, c: { json: (body: unknown, status: number) => Response }) {
  if (!result.success) {
    return c.json(
      {
        error: "Unprocessable Entity",
        message: result.error?.issues?.[0]
          ? JSON.stringify(result.error.issues[0])
          : "Validation failed",
      },
      422,
    );
  }
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/dataset")
  .use(tracerMiddleware({ name: "dataset" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleDatasetError)

  // ── List Datasets (paginated) ──────────────────────────────────
  .get(
    "/",
    describeRoute({
      description: "List all non-archived datasets for the project (paginated)",
    }),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { page, limit } = c.req.valid("query");
      const skip = (page - 1) * limit;

      const [datasets, total] = await Promise.all([
        prisma.dataset.findMany({
          where: { projectId: project.id, archivedAt: null },
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { datasetRecords: true } } },
          skip,
          take: limit,
        }),
        prisma.dataset.count({
          where: { projectId: project.id, archivedAt: null },
        }),
      ]);

      const data = datasets.map((d: { id: string; name: string; slug: string; columnTypes: unknown; createdAt: Date; updatedAt: Date; _count: { datasetRecords: number } }) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        columnTypes: d.columnTypes,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        recordCount: d._count.datasetRecords,
      }));

      return c.json({
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  )

  // ── Create Dataset ─────────────────────────────────────────────
  .post(
    "/",
    describeRoute({
      description: "Create a new dataset",
    }),
    resourceLimitMiddleware("datasets"),
    zValidator("json", createDatasetSchema, validationHook as any),
    async (c) => {
      const project = c.get("project");
      const { name, columnTypes } = c.req.valid("json");

      const service = getService();
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
          },
          201,
        );
      } catch (error) {
        if (error instanceof DatasetConflictError) {
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
  )

  // ── Legacy: Add Entries ────────────────────────────────────────
  .post(
    "/:slug/entries",
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

      const dataset = await prisma.dataset.findFirst({
        where: {
          projectId: project.id,
          OR: [{ slug }, { id: slug }],
        },
      });
      if (!dataset) {
        throw new NotFoundError("Dataset not found");
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
  )

  // ── Get Single Dataset ─────────────────────────────────────────
  .get(
    "/:slugOrId",
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

      const dataset = await prisma.dataset.findFirst({
        where: {
          projectId: project.id,
          archivedAt: null,
          OR: [{ slug: slugOrId }, { id: slugOrId }],
        },
      });
      if (!dataset) {
        throw new NotFoundError("Dataset not found");
      }

      const datasetRecords = await prisma.datasetRecord.findMany({
        where: { datasetId: dataset.id, projectId: project.id },
      });

      const responseSize = JSON.stringify(datasetRecords).length;
      if (responseSize > MAX_LIMIT_MB * 1024 * 1024) {
        throw new BadRequestError(
          `Dataset size exceeds ${MAX_LIMIT_MB}MB limit`,
        );
      }

      return c.json({
        id: dataset.id,
        name: dataset.name,
        slug: dataset.slug,
        columnTypes: dataset.columnTypes,
        createdAt: dataset.createdAt,
        updatedAt: dataset.updatedAt,
        data: datasetRecords,
      });
    },
  )

  // ── Update Dataset ─────────────────────────────────────────────
  .patch(
    "/:slugOrId",
    describeRoute({
      description: "Update a dataset by its slug or id",
    }),
    zValidator("json", updateDatasetSchema),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
      const body = c.req.valid("json");

      const dataset = await resolveDataset({
        slugOrId,
        projectId: project.id,
      });

      const service = getService();

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
        });
      } catch (error) {
        if (error instanceof DatasetConflictError) {
          return c.json(
            {
              error: "Conflict",
              message: "A dataset with this slug already exists",
            },
            409,
          );
        }
        if (error instanceof DatasetNotFoundError) {
          throw new NotFoundError("Dataset not found");
        }
        throw error;
      }
    },
  )

  // ── Delete (Archive) Dataset ───────────────────────────────────
  .delete(
    "/:slugOrId",
    describeRoute({
      description: "Archive a dataset (soft-delete)",
    }),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");

      const dataset = await resolveDataset({
        slugOrId,
        projectId: project.id,
      });

      const slug = slugify(dataset.name);

      await prisma.dataset.update({
        where: {
          id: dataset.id,
          projectId: project.id,
        },
        data: {
          slug: `${slug}-archived-${nanoid()}`,
          archivedAt: new Date(),
        },
      });

      return c.json({ id: dataset.id, archived: true });
    },
  )

  // ── List Records (paginated) ───────────────────────────────────
  .get(
    "/:slugOrId/records",
    describeRoute({
      description: "List records for a dataset (paginated)",
    }),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
      const { page, limit } = c.req.valid("query");
      const skip = (page - 1) * limit;

      const dataset = await resolveDataset({
        slugOrId,
        projectId: project.id,
      });

      const [records, total] = await Promise.all([
        prisma.datasetRecord.findMany({
          where: { datasetId: dataset.id, projectId: project.id },
          orderBy: { createdAt: "asc" },
          skip,
          take: limit,
        }),
        prisma.datasetRecord.count({
          where: { datasetId: dataset.id, projectId: project.id },
        }),
      ]);

      return c.json({
        data: records,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  )

  // ── Update / Upsert Record ─────────────────────────────────────
  .patch(
    "/:slugOrId/records/:recordId",
    describeRoute({
      description: "Update or create a record in a dataset",
    }),
    zValidator("json", updateRecordSchema),
    async (c) => {
      const { slugOrId, recordId } = c.req.param();
      const project = c.get("project");
      const { entry } = c.req.valid("json");

      const dataset = await resolveDataset({
        slugOrId,
        projectId: project.id,
      });

      // Upsert: try to find existing record, update or create
      const existingRecord = await prisma.datasetRecord.findUnique({
        where: { id: recordId, projectId: project.id },
      });

      if (existingRecord) {
        const updated = await prisma.datasetRecord.update({
          where: { id: recordId, projectId: project.id },
          data: { entry },
        });
        return c.json(updated);
      }

      const created = await prisma.datasetRecord.create({
        data: {
          id: recordId,
          entry,
          datasetId: dataset.id,
          projectId: project.id,
        },
      });
      return c.json(created, 201);
    },
  )

  // ── Batch Delete Records ───────────────────────────────────────
  .delete(
    "/:slugOrId/records",
    describeRoute({
      description: "Delete records from a dataset by IDs",
    }),
    zValidator("json", deleteRecordsSchema, validationHook as any),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
      const { recordIds } = c.req.valid("json");

      const dataset = await resolveDataset({
        slugOrId,
        projectId: project.id,
      });

      const { count } = await prisma.datasetRecord.deleteMany({
        where: {
          id: { in: recordIds },
          datasetId: dataset.id,
          projectId: project.id,
        },
      });

      if (count === 0) {
        throw new NotFoundError("No matching records found");
      }

      return c.json({ deletedCount: count });
    },
  );
