import { tool } from "ai";
import { z } from "zod";
import { datasetColumnTypeSchema } from "../../../../server/datasets/types";

export const addRowInputSchema = z.object({
  row: z.array(z.string()),
});

export const updateRowInputSchema = z.object({
  id: z.string(),
  row: z.array(z.string()),
});

export const changeColumnsInputSchema = z.object({
  columns: z.record(z.string(), datasetColumnTypeSchema),
});

export const deleteRowInputSchema = z.object({
  id: z.string(),
});

export const addRow = tool({
  description: "Adds a row to the dataset, each row is an array of values matching each column of the dataset EXCEPT the id column",
  inputSchema: addRowInputSchema,
});

export const updateRow = tool({
  description: "Updates a row in the dataset, each row is an array of values matching each column of the dataset except the id column",
  inputSchema: updateRowInputSchema,
});

export const changeColumns = tool({
  description: "Changes the columns of the dataset",
  inputSchema: changeColumnsInputSchema,
});

export const deleteRow = tool({
  description: "Deletes a row from the dataset by the id",
  inputSchema: deleteRowInputSchema,
});

export const tools = {
  addRow,
  updateRow,
  // changeColumns,
  deleteRow,
};
