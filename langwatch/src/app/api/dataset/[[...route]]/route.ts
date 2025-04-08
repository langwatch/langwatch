import { validator as zValidator } from "hono-openapi/zod";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { z } from "zod";
import { createManyDatasetRecords } from "../../../../server/api/routers/datasetRecord";
import type { DatasetColumns } from "../../../../server/datasets/types";
import { prisma } from "../../../../server/db";
import { describeRoute } from "hono-openapi";
import "zod-openapi/extend";

export const app = new Hono().basePath("/api/dataset");

app.post(
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
      .openapi({ ref: "DatasetPostEntries" })
  ),
  async (c) => {
    const { slug } = c.req.param();
    const apiKey =
      c.req.header("X-Auth-Token") ??
      c.req.header("Authorization")?.split(" ")[1];
    const { entries } = c.req.valid("json");

    if (!apiKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const project = await prisma.project.findUnique({
      where: { apiKey },
    });
    if (!project) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const dataset = await prisma.dataset.findFirst({
      where: {
        projectId: project.id,
        OR: [{ slug }, { id: slug }],
      },
    });
    if (!dataset) {
      return c.json({ error: "Dataset not found" }, 404);
    }

    const columns = Object.fromEntries(
      (dataset.columnTypes as DatasetColumns).map((column) => [
        column.name,
        column.type,
      ])
    );
    for (const entry of entries) {
      for (const [key] of Object.entries(entry)) {
        if (!columns[key]) {
          return c.json(
            {
              error: `Column \`${key}\` is not present in the \`${dataset.name}\` dataset`,
            },
            400
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
  }
);

export const POST = handle(app);
