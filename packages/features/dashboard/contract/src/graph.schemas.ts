/**
 * The inputs the `graphs.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 */
import { z } from "zod";

/**
 * Where a card sits on the dashboard grid. Shared as loose fields rather than
 * a schema because `create` takes each one optionally and the layout writes
 * take them all.
 */
export const graphApiLayoutShape = {
  gridColumn: z.number().min(0).max(1),
  gridRow: z.number().min(0),
  colSpan: z.number().min(1).max(2),
  rowSpan: z.number().min(1).max(2),
};

export const graphApiCreateInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  graph: z.string(),
  filterParams: z.any().optional(),
  dashboardId: z.string().optional(),
  gridColumn: graphApiLayoutShape.gridColumn.optional(),
  gridRow: graphApiLayoutShape.gridRow.optional(),
  colSpan: graphApiLayoutShape.colSpan.optional(),
  rowSpan: graphApiLayoutShape.rowSpan.optional(),
});

/** One project's graphs, optionally narrowed to one dashboard. */
export const graphApiListInputSchema = z.object({
  projectId: z.string(),
  dashboardId: z.string().optional(),
});

/** One graph inside one project. */
export const graphApiGraphInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
});

export const graphApiUpdateInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  graph: z.string(),
  graphId: z.string(),
  filterParams: z.any().optional(),
});

export const graphApiUpdateLayoutInputSchema = z.object({
  projectId: z.string(),
  graphId: z.string(),
  ...graphApiLayoutShape,
});

export const graphApiBatchUpdateLayoutsInputSchema = z.object({
  projectId: z.string(),
  layouts: z.array(z.object({ graphId: z.string(), ...graphApiLayoutShape })),
});

export type GraphApiCreateInput = z.infer<typeof graphApiCreateInputSchema>;
export type GraphApiListInput = z.infer<typeof graphApiListInputSchema>;
export type GraphApiGraphInput = z.infer<typeof graphApiGraphInputSchema>;
export type GraphApiUpdateInput = z.infer<typeof graphApiUpdateInputSchema>;
export type GraphApiUpdateLayoutInput = z.infer<typeof graphApiUpdateLayoutInputSchema>;
export type GraphApiBatchUpdateLayoutsInput = z.infer<typeof graphApiBatchUpdateLayoutsInputSchema>;
