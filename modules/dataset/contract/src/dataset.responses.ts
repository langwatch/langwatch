import type { Named } from "@langwatch/module";
/** tRPC transport answers stated once in the contract's `withOutput`;
 * schemas checked against real answers in development and test.
 */
import { z } from "zod";

import { datasetRecordSchema, datasetWireSchema } from "./dataset.ts";

/**
 * `datasetRecord.getAll`/`download`: the dataset's fields, flattened,
 * plus `datasetRecords` and whether the read was truncated. Kept as its
 * own schema (historical, flattened) so a Dataset field can't drift the two apart.
 */
const datasetRecordEditorReadSchemaDefinition = datasetWireSchema.safeExtend({
  datasetRecords: z.array(datasetRecordSchema),
  /** True whenever the dataset holds a row that `datasetRecords` leaves out. */
  truncated: z.boolean(),
  /** How many rows `datasetRecords` carries. */
  loadedRows: z.number().int().nonnegative(),
  /** How many rows the dataset holds. */
  totalRows: z.number().int().nonnegative(),
});
export interface DatasetRecordEditorReadSchema extends Named<
  typeof datasetRecordEditorReadSchemaDefinition
> {}
export const datasetRecordEditorReadSchema: DatasetRecordEditorReadSchema =
  datasetRecordEditorReadSchemaDefinition;

/** `datasetRecord.getHead`: the first entries plus the authoritative total. */
const datasetRecordHeadReadSchemaDefinition = z
  .object({
    dataset: datasetWireSchema.safeExtend({ datasetRecords: z.array(datasetRecordSchema) }),
    total: z.number().int().nonnegative(),
  })
  .strict();
export interface DatasetRecordHeadReadSchema extends Named<
  typeof datasetRecordHeadReadSchemaDefinition
> {}
export const datasetRecordHeadReadSchema: DatasetRecordHeadReadSchema =
  datasetRecordHeadReadSchemaDefinition;
