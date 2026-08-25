import { z } from "zod";

export const graphIdSchema = z.string().min(1);
export const graphNameSchema = z.string().trim().min(1).max(255);
export const graphPayloadSchema = z.record(z.string(), z.unknown());
export const graphFiltersSchema = z.record(z.string(), z.unknown());

export const graphLayoutSchema = z.object({
  gridColumn: z.number().int().min(0).max(1),
  gridRow: z.number().int().min(0),
  colSpan: z.number().int().min(1).max(2),
  rowSpan: z.number().int().min(1).max(2),
}).strict();

export const graphCreateInputSchema = z.object({
  projectId: z.string().min(1),
  name: graphNameSchema,
  graph: graphPayloadSchema,
  filters: graphFiltersSchema.optional(),
  dashboardId: z.string().min(1).optional(),
  ...graphLayoutSchema.partial().shape,
}).strict();

export const graphUpdateInputSchema = z.object({
  projectId: z.string().min(1),
  graphId: graphIdSchema,
  name: graphNameSchema.optional(),
  graph: graphPayloadSchema.optional(),
  filters: graphFiltersSchema.optional(),
}).strict();

export const graphLayoutUpdateInputSchema = z.object({
  projectId: z.string().min(1),
  graphId: graphIdSchema,
  ...graphLayoutSchema.shape,
}).strict();

export type GraphLayout = z.infer<typeof graphLayoutSchema>;

export const graphSchema = graphLayoutSchema.extend({
  id: graphIdSchema,
  projectId: z.string().min(1),
  name: graphNameSchema,
  graph: graphPayloadSchema,
  filters: graphFiltersSchema.nullable(),
  dashboardId: z.string().min(1).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Graph = z.infer<typeof graphSchema>;
