import {
  chartGridPlacementSchema,
  fitsChartGridWidth,
} from "@langwatch/analytics-contract/chart-grid";
import { z } from "zod";

/** The house id scheme's kind for a chart-builder graph. */
export const GRAPH_KSUID_RESOURCE = "graph";

/** The house id scheme's kind for a custom chart widget on the same grid. */
export const DASHBOARD_WIDGET_KSUID_RESOURCE = "widget";

export const graphIdSchema = z.string().min(1);
export const graphNameSchema = z.string().trim().min(1);
export const graphPayloadSchema = z.record(z.string(), z.unknown());
export const graphFiltersSchema = z.record(z.string(), z.unknown());

/** Where a graph sits on the dashboard's chart grid, within each bound of the grid. */
export const graphLayoutSchema = chartGridPlacementSchema.strict();

/** A layout the grid can draw: its column and span also stay inside the right edge. */
export const graphPlacementSchema = graphLayoutSchema.refine(fitsChartGridWidth, {
  message: "gridColumn + colSpan must not exceed the grid's columns",
  path: ["colSpan"],
});

export const graphCreateInputSchema = z
  .object({
    projectId: z.string().min(1),
    name: graphNameSchema,
    graph: graphPayloadSchema,
    filters: graphFiltersSchema.optional(),
    dashboardId: z.string().min(1).optional(),
    ...graphLayoutSchema.partial().shape,
  })
  .strict();

export const graphUpdateInputSchema = z
  .object({
    projectId: z.string().min(1),
    graphId: graphIdSchema,
    name: graphNameSchema.optional(),
    graph: graphPayloadSchema.optional(),
    filters: graphFiltersSchema.optional(),
  })
  .strict();

export const graphLayoutUpdateInputSchema = z
  .object({
    projectId: z.string().min(1),
    graphId: graphIdSchema,
    ...graphLayoutSchema.shape,
  })
  .strict();

export type GraphLayout = z.infer<typeof graphLayoutSchema>;

// -- what `/api/graphs` accepts ----------------------------------------------

export const graphRestListQuerySchema = z.object({ dashboardId: z.string().optional() });

export const graphRestParamsSchema = z.object({ id: z.string().min(1) });

export const graphRestCreateSchema = z.object({
  name: z.string().min(1, "name is required"),
  graph: z.record(z.string(), z.unknown()),
  dashboardId: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  gridColumn: z.number().min(0).max(1).optional(),
  gridRow: z.number().min(0).optional(),
  colSpan: z.number().min(1).max(2).optional(),
  rowSpan: z.number().min(1).max(2).optional(),
});

export const graphRestUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  graph: z.record(z.string(), z.unknown()).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export const graphSchema = z
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
export type Graph = z.infer<typeof graphSchema>;
