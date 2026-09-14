/** tRPC transport answers stated once in the contract's `withOutput`;
 * schemas checked against real answers in development and test.
 */
import { z } from "zod";
import { datasetRecordSchema, datasetSchema } from "./dataset.ts";

/**
 * `datasetRecord.getAll` / `datasetRecord.download`: the stored dataset's own
 * fields, flattened, plus its records under `datasetRecords` and whether the
 * read was truncated by the caller's byte budget. This is the editor's
 * historical wire shape — flattened rather than `{ dataset, records }` — kept
 * as its own schema so a future field on `Dataset` cannot silently drift the
 * two apart.
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
