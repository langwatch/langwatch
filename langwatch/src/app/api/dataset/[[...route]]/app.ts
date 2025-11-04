import { resolver, validator as zValidator } from "hono-openapi/zod";
import { Hono } from "hono";
import { z } from "zod";
import { createManyDatasetRecords } from "../../../../server/api/routers/datasetRecord";
import type { DatasetColumns } from "../../../../server/datasets/types";
import { prisma } from "../../../../server/db";
import { describeRoute } from "hono-openapi";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import { loggerMiddleware } from "../../middleware/logger";
import {
  UnauthorizedError,
  NotFoundError,
  BadRequestError,
  UnprocessableEntityError,
} from "../../shared/errors";
import { baseResponses } from "../../shared/base-responses";
import { MAX_LIMIT_MB } from "./constants";
import { buildStandardSuccessResponse } from "./utils";
import { datasetOutputSchema } from "./schemas";
import { errorSchema } from "../../shared/schemas";
import { handleDatasetError } from "./error-handler";
patchZodOpenapi();

export const app = new Hono()
  .basePath("/api/dataset")
  .use(loggerMiddleware())
  .onError(handleDatasetError)

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
      const apiKey =
        c.req.header("X-Auth-Token") ??
        c.req.header("Authorization")?.split(" ")[1];
      const { entries } = c.req.valid("json");

      if (!apiKey) {
        throw new UnauthorizedError();
      }
      const project = await prisma.project.findUnique({
        where: { apiKey },
      });
      if (!project) {
        throw new UnauthorizedError();
      }

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

      const apiKey =
        c.req.header("X-Auth-Token") ??
        c.req.header("Authorization")?.split(" ")[1];
      if (!apiKey) {
        throw new UnauthorizedError();
      }

      const project = await prisma.project.findUnique({
        where: { apiKey },
      });
      if (!project) {
        throw new UnauthorizedError();
      }

      const dataset = await prisma.dataset.findFirst({
        where: {
          projectId: project.id,
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

      return c.json({ data: datasetRecords });
    },
  );
