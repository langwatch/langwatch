/**
 * The dashboard widget procedures the custom-chart playground calls, at main's
 * `dashboardWidgets.*` path with main's inputs and outputs. The REST family is
 * `dashboard-widget-rest.schemas.ts`. Spec: custom-chart-playground-dashboard-placement.feature.
 */
import { DASHBOARD_SRCDOC_CHART_KIND } from "@langwatch/analytics-contract";
import {
  chartGridPlacementSchema,
  fitsChartGridWidth,
} from "@langwatch/analytics-contract/chart-grid";
import {
  dashboardWidgetCodeSchema,
  dashboardWidgetDefinitionSchema,
  dashboardWidgetNameSchema,
  dashboardWidgetQueriesSchema,
} from "@langwatch/analytics-contract/dashboard-widget-definition";
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

const projectScopeSchema = z.object({ projectId: z.string() });

const fitsGridWidth = {
  message: "gridColumn + colSpan must not exceed the grid's columns",
  path: ["colSpan"],
};

const dashboardWidgetLayoutSchema = chartGridPlacementSchema.refine(
  fitsChartGridWidth,
  fitsGridWidth,
);

const placementShape = {
  dashboardId: z.string().nullable(),
  gridColumn: z.number().int(),
  gridRow: z.number().int(),
  colSpan: z.number().int(),
  rowSpan: z.number().int(),
};

/** A widget as main's `create` answered it: the definition already parsed. */
export const dashboardWidgetTrpcSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  definition: dashboardWidgetDefinitionSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  ...placementShape,
});

/** A widget as main's `list` answered it: the stored chart row, its definition under `graph`. */
export const dashboardWidgetTrpcRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  graph: dashboardWidgetDefinitionSchema,
  filters: z.null(),
  kind: z.literal(DASHBOARD_SRCDOC_CHART_KIND),
  createdAt: z.date(),
  updatedAt: z.date(),
  ...placementShape,
});

export const dashboardWidgetTrpcSuccessSchema = z.object({ success: z.literal(true) });

export const dashboardWidgetTrpc = defineTrpcContract("dashboardWidgets")
  .query("list")
  .withInput(projectScopeSchema)
  .withOutput(dashboardWidgetTrpcRowSchema.array())

  .mutation("create")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      dashboardId: z.string().optional(),
      name: dashboardWidgetNameSchema,
      code: dashboardWidgetCodeSchema,
      queries: dashboardWidgetQueriesSchema,
    }),
  )
  .withOutput(dashboardWidgetTrpcSchema)

  .mutation("update")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      id: z.string(),
      name: dashboardWidgetNameSchema.optional(),
      code: dashboardWidgetCodeSchema,
      queries: dashboardWidgetQueriesSchema,
    }),
  )
  .withOutput(dashboardWidgetTrpcSuccessSchema)

  .mutation("updateLayout")
  .withInput(
    z
      .object({
        ...chartGridPlacementSchema.shape,
        ...projectScopeSchema.shape,
        graphId: z.string(),
      })
      .refine(fitsChartGridWidth, fitsGridWidth),
  )
  .withOutput(dashboardWidgetTrpcSuccessSchema)

  .mutation("batchUpdateLayouts")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      layouts: z.array(z.object({ graphId: z.string() }).and(dashboardWidgetLayoutSchema)),
    }),
  )
  .withOutput(dashboardWidgetTrpcSuccessSchema)

  .mutation("assignDashboard")
  .withInput(z.object({ ...projectScopeSchema.shape, id: z.string(), dashboardId: z.string() }))
  .withOutput(dashboardWidgetTrpcSuccessSchema)

  .mutation("delete")
  .withInput(z.object({ ...projectScopeSchema.shape, id: z.string() }))
  .withOutput(dashboardWidgetTrpcSuccessSchema)
  .build();
