/**
 * Every `datasetRecord.*` procedure, declared once. The editor, the export and
 * the previews all read a dataset's entries through this namespace; the server
 * binds a permission and a handler to a name declared here.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { datasetPageSchema, datasetRecordSchema } from "./dataset.ts";
import {
  datasetRecordApiCreateInputSchema,
  datasetRecordApiDeleteManyInputSchema,
  datasetRecordApiLookupInputSchema,
  datasetRecordApiPageInputSchema,
  datasetRecordApiUpdateInputSchema,
} from "./dataset.schemas.ts";
import {
  datasetRecordEditorReadSchema,
  datasetRecordHeadReadSchema,
} from "./dataset.responses.ts";
import { datasetRecordMutationResultSchema } from "./dataset.ts";

/** What a batch delete answers: how many entries it removed. */
export const datasetRecordsDeletedSchema = z.object({ count: z.number() }).strict();

export const datasetRecordTrpc = defineTrpcContract("datasetRecord")
  /** New entries appended to a dataset. */
  .mutation("create")
  .withInput(datasetRecordApiCreateInputSchema)
  .withOutput(z.array(datasetRecordSchema))

  /** One entry replaced, or created, by id. */
  .mutation("update")
  .withInput(datasetRecordApiUpdateInputSchema)
  .withOutput(datasetRecordMutationResultSchema)

  /** The whole dataset for the editor, capped by the editor's byte budget. */
  .query("getAll")
  .withInput(datasetRecordApiLookupInputSchema)
  .withOutput(datasetRecordEditorReadSchema)

  /** One page of a dataset for the editor's classic page N of M. */
  .query("listPaginated")
  .withInput(datasetRecordApiPageInputSchema)
  .withOutput(datasetPageSchema.nullable())

  /** The whole dataset with no byte cap, for export. */
  .mutation("download")
  .withInput(datasetRecordApiLookupInputSchema)
  .withOutput(datasetRecordEditorReadSchema)

  /** The first entries plus the authoritative total, for previews. */
  .query("getHead")
  .withInput(datasetRecordApiLookupInputSchema)
  .withOutput(datasetRecordHeadReadSchema)

  /** Entries removed by id. */
  .mutation("deleteMany")
  .withInput(datasetRecordApiDeleteManyInputSchema)
  .withOutput(datasetRecordsDeletedSchema)
  .build();
