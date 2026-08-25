import { datasetRecordSchema } from "@langwatch/dataset-contract";
import { z } from "zod/v4";

export const datasetOutputSchema = z.object({
  data: z.array(datasetRecordSchema),
});
