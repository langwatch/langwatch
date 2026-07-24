import { tool } from "ai";
import Parse from "papaparse";
import { z } from "zod";

export const tools = (dataset: string) => {
  const parsedDataset = Parse.parse(dataset, { header: true });
  const columnNames = parsedDataset.meta.fields?.filter(
    (field) => field !== "id",
  );

  const addRow = tool({
    description:
      "Adds a SINGLE row to the dataset. To add multiple rows, call this tool multiple times. The row is an object with values for each column (excluding the id column which is auto-generated).",
    inputSchema: z.object({
      row: z.object(
        Object.fromEntries(
          columnNames?.map((column) => [column, z.string()]) ?? [],
        ),
      ),
    }),
  });

  const updateRow = tool({
    description:
      "Updates a row in the dataset, each row is an array of values matching each column of the dataset EXCEPT the id column",
    inputSchema: z.object({
      id: z.string(),
      row: z.object(
        Object.fromEntries(
          columnNames?.map((column) => [column, z.string()]) ?? [],
        ),
      ),
    }),
  });

  // const changeColumns = tool({
  //   description: "Changes the columns of the dataset",
  //   inputSchema: z.record(z.string(), datasetColumnTypeSchema),
  // });

  const deleteRow = tool({
    description: "Deletes a row from the dataset by the id",
    inputSchema: z.object({
      id: z.string(),
    }),
  });

  return {
    addRow,
    updateRow,
    deleteRow,
  };
};
