import { tool } from "ai";
import { z } from "zod";
import type { LangyToolContext } from "./types";

export function makeListDatasets(ctx: LangyToolContext) {
  return tool({
    description:
      "Lists the datasets in the caller's project with their column schema and row count.",
    inputSchema: z.object({}),
    execute: async () => {
      const datasets = await ctx.datasetService.listAllNonArchivedWithCounts({
        projectId: ctx.projectId,
      });
      for (const d of datasets) ctx.seenIds.record("dataset_id", d.id);
      return {
        items: datasets.map((d) => ({
          id: d.id,
          slug: d.slug,
          name: d.name,
          columnTypes: d.columnTypes,
          rowCount: d._count.datasetRecords,
        })),
      };
    },
  });
}

export function makeGetDatasetDetails(ctx: LangyToolContext) {
  return tool({
    description:
      "Fetch a dataset's schema and a sample of its rows so you can understand its content before proposing additions or changes.",
    inputSchema: z.object({
      datasetId: z
        .string()
        .describe("The dataset id as returned by list_datasets."),
      sampleRowLimit: z.number().int().min(0).max(20).default(5),
    }),
    execute: async ({ datasetId, sampleRowLimit }) => {
      const dataset = await ctx.datasetService.findByIdNonArchivedWithCounts({
        id: datasetId,
        projectId: ctx.projectId,
      });
      if (!dataset) {
        return { error: `No dataset found with id '${datasetId}'.` };
      }
      const sampleRows =
        sampleRowLimit > 0
          ? await ctx.datasetService.listRecordsSample({
              datasetId,
              projectId: ctx.projectId,
              limit: sampleRowLimit,
            })
          : [];
      return {
        id: dataset.id,
        slug: dataset.slug,
        name: dataset.name,
        columnTypes: dataset.columnTypes,
        rowCount: dataset._count.datasetRecords,
        sampleRows,
      };
    },
  });
}

export function makeProposeCreateDataset(_ctx: LangyToolContext) {
  return tool({
    description:
      "Propose creating a new dataset with a schema (column names + types) and optional seed rows you author inline. Use this before propose_add_dataset_rows if the dataset does not yet exist.",
    inputSchema: z.object({
      name: z.string().min(1).max(120),
      columns: z
        .array(
          z.object({
            name: z.string().min(1),
            type: z.enum([
              "string",
              "boolean",
              "number",
              "date",
              "list",
              "json",
            ]),
          }),
        )
        .min(1)
        .describe("Schema: column name + value type."),
      initialRows: z
        .array(z.record(z.unknown()))
        .optional()
        .describe(
          "Optional seed rows. Each row is an object mapping column name to value. Keep values consistent with declared column types.",
        ),
      rationale: z.string(),
    }),
    execute: async ({ name, columns, initialRows, rationale }) => {
      return {
        langyProposal: true,
        kind: "datasets.create",
        summary: `Create dataset "${name}"${
          initialRows?.length ? ` with ${initialRows.length} row(s)` : ""
        }`,
        rationale,
        payload: {
          name,
          columnTypes: columns,
          initialRows: initialRows ?? [],
        },
      };
    },
  });
}

export function makeProposeAddDatasetRows(ctx: LangyToolContext) {
  return tool({
    description:
      "Propose appending rows to an existing dataset. Each row is an object mapping column name to value. Values must be consistent with the dataset's column types (call get_dataset_details first to confirm).",
    inputSchema: z.object({
      datasetId: z.string(),
      rows: z
        .array(z.record(z.unknown()))
        .min(1)
        .max(50)
        .describe("Up to 50 rows; each row is { columnName: value }."),
      rationale: z.string(),
    }),
    execute: async ({ datasetId, rows, rationale }) => {
      if (!ctx.seenIds.has("dataset_id", datasetId)) {
        return {
          error: `Dataset '${datasetId}' was not surfaced by list_datasets in this conversation. Call list_datasets first and reference one of those ids.`,
        };
      }
      const dataset = await ctx.datasetService.findByIdNonArchivedWithCounts({
        id: datasetId,
        projectId: ctx.projectId,
      });
      if (!dataset) {
        return { error: `No dataset found with id '${datasetId}'.` };
      }
      return {
        langyProposal: true,
        kind: "datasets.addRows",
        summary: `Add ${rows.length} row(s) to "${dataset.name}"`,
        rationale,
        payload: {
          datasetId,
          rows,
        },
      };
    },
  });
}
