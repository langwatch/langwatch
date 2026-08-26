import { z } from "zod";

export const traceQueryFieldCatalogueInputSchema = z.object({
  projectId: z.string(),
  timeRange: z.object({
    from: z.number(),
    to: z.number(),
  }),
});

export const traceQueryFieldCatalogueOutputSchema = z.string();

export type TraceQueryFieldCatalogueInput = z.infer<
  typeof traceQueryFieldCatalogueInputSchema
>;
