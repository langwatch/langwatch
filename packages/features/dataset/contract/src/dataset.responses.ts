/**
 * What the dataset feature's tRPC transports answer, stated once.
 *
 * The chain declares each procedure's `withOutput` from here, so the shape a
 * client reads is written down in the contract rather than implied by
 * whatever a handler happened to return. The schemas are checked against
 * real answers in development and test; production returns the handler's
 * own value.
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
