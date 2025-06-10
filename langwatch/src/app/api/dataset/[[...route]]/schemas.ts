import { z } from "zod";

export const errorSchema = z.object({
  status: z.string().default("error"),
  message: z.string(),
});

export const datasetOutputSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    datasetId: z.string(),
    projectId: z.string(),
    entry: z.record(z.string(), z.any()),
    createdAt: z.date(),
    updatedAt: z.date(),
  })),
});
