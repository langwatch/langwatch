/** tRPC transport answers stated once in the contract's `withOutput`;
 * schemas checked against real answers in development and test.
 */
import { z } from "zod";
import { datasetRecordSchema, datasetSchema } from "./dataset.ts";

/**
 * `datasetRecord.getAll`/`download`: the dataset's fields, flattened,
 * plus `datasetRecords` and whether the read was truncated. Kept as its
 * own schema (historical, flattened) so a Dataset field can't drift the two apart.
 */
export const datasetRecordEditorReadSchema = datasetSchema.extend({
  datasetRecords: z.array(datasetRecordSchema),
  truncated: z.boolean(),
});

/** `datasetRecord.getHead`: the first entries plus the authoritative total. */
export const datasetRecordHeadReadSchema = z
  .object({
    dataset: datasetSchema.extend({ datasetRecords: z.array(datasetRecordSchema) }),
    total: z.number().int().nonnegative(),
  })
  .strict();
