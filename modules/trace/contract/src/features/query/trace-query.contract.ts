import type { Named } from "@langwatch/module";
import { z } from "zod";

const traceQueryFieldCatalogueInputSchemaDefinition = z.object({
  projectId: z.string(),
  timeRange: z.object({
    from: z.number(),
    to: z.number(),
  }),
});
export interface TraceQueryFieldCatalogueInputSchema extends Named<
  typeof traceQueryFieldCatalogueInputSchemaDefinition
> {}
export const traceQueryFieldCatalogueInputSchema: TraceQueryFieldCatalogueInputSchema =
  traceQueryFieldCatalogueInputSchemaDefinition;

export const traceQueryFieldCatalogueOutputSchema = z.string();

const traceQueryClassificationInputSchemaDefinition = z.object({
  query: z.string(),
});
export interface TraceQueryClassificationInputSchema extends Named<
  typeof traceQueryClassificationInputSchemaDefinition
> {}
export const traceQueryClassificationInputSchema: TraceQueryClassificationInputSchema =
  traceQueryClassificationInputSchemaDefinition;

const traceQueryClassificationSchemaDefinition = z.object({
  evaluations: z.boolean(),
  events: z.boolean(),
  spans: z.boolean(),
});
export interface TraceQueryClassificationSchema extends Named<
  typeof traceQueryClassificationSchemaDefinition
> {}
export const traceQueryClassificationSchema: TraceQueryClassificationSchema =
  traceQueryClassificationSchemaDefinition;

export type TraceQueryFieldCatalogueInput = z.infer<typeof traceQueryFieldCatalogueInputSchema>;

export type TraceQueryClassificationInput = z.infer<typeof traceQueryClassificationInputSchema>;

export type TraceQueryClassification = z.infer<typeof traceQueryClassificationSchema>;
