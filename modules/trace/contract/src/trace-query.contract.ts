import { z } from "zod";

export const traceQueryFieldCatalogueInputSchema = z.object({
  projectId: z.string(),
  timeRange: z.object({
    from: z.number(),
    to: z.number(),
  }),
});

export const traceQueryFieldCatalogueOutputSchema = z.string();

export const traceQueryClassificationInputSchema = z.object({
  query: z.string(),
});

export const traceQueryClassificationSchema = z.object({
  evaluations: z.boolean(),
  events: z.boolean(),
  spans: z.boolean(),
});

export type TraceQueryFieldCatalogueInput = z.infer<typeof traceQueryFieldCatalogueInputSchema>;

export type TraceQueryClassificationInput = z.infer<typeof traceQueryClassificationInputSchema>;

export type TraceQueryClassification = z.infer<typeof traceQueryClassificationSchema>;
