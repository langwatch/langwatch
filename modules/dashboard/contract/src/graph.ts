import {
  chartGridPlacementSchema,
  fitsChartGridWidth,
} from "@langwatch/analytics-contract/chart-grid";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The house id scheme's kind for a chart-builder graph. */
export const GRAPH_KSUID_RESOURCE = "graph";

/** The house id scheme's kind for a custom chart widget on the same grid. */
export const DASHBOARD_WIDGET_KSUID_RESOURCE = "widget";

export const graphIdSchema = z.string().min(1);
export const graphNameSchema = z.string().trim().min(1);
const graphPayloadSchemaDefinition = z.record(z.string(), z.unknown());
export interface GraphPayloadSchema extends Named<typeof graphPayloadSchemaDefinition> {}
export const graphPayloadSchema: GraphPayloadSchema = graphPayloadSchemaDefinition;
const graphFiltersSchemaDefinition = z.record(z.string(), z.unknown());
export interface GraphFiltersSchema extends Named<typeof graphFiltersSchemaDefinition> {}
export const graphFiltersSchema: GraphFiltersSchema = graphFiltersSchemaDefinition;

/** Where a graph sits on the dashboard's chart grid, within each bound of the grid. */
const graphLayoutSchemaDefinition = chartGridPlacementSchema.strict();
export interface GraphLayoutSchema extends Named<typeof graphLayoutSchemaDefinition> {}
export const graphLayoutSchema: GraphLayoutSchema = graphLayoutSchemaDefinition;

/** A layout the grid can draw: its column and span also stay inside the right edge. */
const graphPlacementSchemaDefinition = graphLayoutSchema.refine(fitsChartGridWidth, {
  message: "gridColumn + colSpan must not exceed the grid's columns",
  path: ["colSpan"],
});
export interface GraphPlacementSchema extends Named<typeof graphPlacementSchemaDefinition> {}
export const graphPlacementSchema: GraphPlacementSchema = graphPlacementSchemaDefinition;

const graphCreateInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    name: graphNameSchema,
    graph: graphPayloadSchema,
    filters: graphFiltersSchema.optional(),
    dashboardId: z.string().min(1).optional(),
    ...graphLayoutSchema.partial().shape,
  })
  .strict();
export interface GraphCreateInputSchema extends Named<typeof graphCreateInputSchemaDefinition> {}
export const graphCreateInputSchema: GraphCreateInputSchema = graphCreateInputSchemaDefinition;

const graphUpdateInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    graphId: graphIdSchema,
    name: graphNameSchema.optional(),
    graph: graphPayloadSchema.optional(),
    filters: graphFiltersSchema.optional(),
  })
  .strict();
export interface GraphUpdateInputSchema extends Named<typeof graphUpdateInputSchemaDefinition> {}
export const graphUpdateInputSchema: GraphUpdateInputSchema = graphUpdateInputSchemaDefinition;

const graphLayoutUpdateInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    graphId: graphIdSchema,
    ...graphLayoutSchema.shape,
  })
  .strict();
export interface GraphLayoutUpdateInputSchema extends Named<
  typeof graphLayoutUpdateInputSchemaDefinition
> {}
export const graphLayoutUpdateInputSchema: GraphLayoutUpdateInputSchema =
  graphLayoutUpdateInputSchemaDefinition;

export type GraphLayout = z.infer<typeof graphLayoutSchema>;

// -- what `/api/graphs` accepts ----------------------------------------------

const graphRestListQuerySchemaDefinition = z.object({ dashboardId: z.string().optional() });
export interface GraphRestListQuerySchema extends Named<
  typeof graphRestListQuerySchemaDefinition
> {}
export const graphRestListQuerySchema: GraphRestListQuerySchema =
  graphRestListQuerySchemaDefinition;

const graphRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface GraphRestParamsSchema extends Named<typeof graphRestParamsSchemaDefinition> {}
export const graphRestParamsSchema: GraphRestParamsSchema = graphRestParamsSchemaDefinition;

const graphRestCreateSchemaDefinition = z.object({
  name: z.string().min(1, "name is required"),
  graph: z.record(z.string(), z.unknown()),
  dashboardId: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  gridColumn: z.number().min(0).max(1).optional(),
  gridRow: z.number().min(0).optional(),
  colSpan: z.number().min(1).max(2).optional(),
  rowSpan: z.number().min(1).max(2).optional(),
});
export interface GraphRestCreateSchema extends Named<typeof graphRestCreateSchemaDefinition> {}
export const graphRestCreateSchema: GraphRestCreateSchema = graphRestCreateSchemaDefinition;

const graphRestUpdateSchemaDefinition = z.object({
  name: z.string().min(1).optional(),
  graph: z.record(z.string(), z.unknown()).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});
export interface GraphRestUpdateSchema extends Named<typeof graphRestUpdateSchemaDefinition> {}
export const graphRestUpdateSchema: GraphRestUpdateSchema = graphRestUpdateSchemaDefinition;

const graphSchemaDefinition = z
  .object({
    ...graphLayoutSchema.shape,
    id: graphIdSchema,
    projectId: z.string().min(1),
    name: graphNameSchema,
    graph: graphPayloadSchema,
    filters: graphFiltersSchema.nullable(),
    dashboardId: z.string().min(1).nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface GraphSchema extends Named<typeof graphSchemaDefinition> {}
export const graphSchema: GraphSchema = graphSchemaDefinition;
export type Graph = z.infer<typeof graphSchema>;
