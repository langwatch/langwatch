import { datasetRecordSchema } from "@langwatch/dataset-contract";
import { z } from "zod";

export const datasetOutputSchema = z.object({
  data: z.array(datasetRecordSchema),
});
