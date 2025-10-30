import { z } from "zod";

export const datasetOutputSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      datasetId: z.string(),
      projectId: z.string(),
      entry: z.record(z.string(), z.any()),
      createdAt: z.date(),
      updatedAt: z.date(),
    })
  ),
});
