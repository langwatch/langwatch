/**
 * The dashboard-widget REST family's wire shapes, built from the widget schema pieces
 * every write surface shares, so REST accepts exactly what tRPC accepts.
 */
import {
  dashboardWidgetCodeSchema,
  dashboardWidgetDescriptionSchema,
  dashboardWidgetNameSchema,
  dashboardWidgetPromptSchema,
  dashboardWidgetQueriesSchema,
  dashboardWidgetQuerySchema,
  dashboardWidgetSourceSchema,
} from "@langwatch/analytics-contract/dashboard-widget-definition";
import { z } from "zod";

export const createDashboardWidgetSchema = z.object({
  name: dashboardWidgetNameSchema,
  code: dashboardWidgetCodeSchema,
  queries: dashboardWidgetQueriesSchema,
  description: dashboardWidgetDescriptionSchema.optional(),
  prompt: dashboardWidgetPromptSchema.optional(),
  /** Where the widget came from; the API records `{ kind: "api" }` when the body names none. */
  source: dashboardWidgetSourceSchema.optional(),
});

export const updateDashboardWidgetSchema = z
  .object({
    name: dashboardWidgetNameSchema.optional(),
    code: dashboardWidgetCodeSchema.optional(),
    queries: dashboardWidgetQueriesSchema.optional(),
    description: dashboardWidgetDescriptionSchema.optional(),
    source: dashboardWidgetSourceSchema.optional(),
  })
  // A PATCH naming nothing is a mistake worth reporting; a field it leaves out keeps its value.
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    "Provide at least one of name, code, queries, description or source.",
  )
  .meta({ minProperties: 1 });

/** A placement request's envelope: the dashboard a widget is added to. */
export const assignDashboardWidgetToDashboardSchema = z.object({
  dashboardId: z.string().min(1),
});

export const dashboardWidgetResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: z.object({
    version: z.number(),
    code: z.string(),
    queries: z.array(dashboardWidgetQuerySchema),
    description: z.string().optional(),
    prompt: z.string().optional(),
    source: dashboardWidgetSourceSchema.optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string(),
  /** `null` when the widget has never been placed on a dashboard. */
  dashboardId: z.string().nullable(),
  gridColumn: z.number().int(),
  gridRow: z.number().int(),
  colSpan: z.number().int(),
  rowSpan: z.number().int(),
});

export const dashboardWidgetListSchema = z.object({
  data: z.array(dashboardWidgetResourceSchema),
});

export const dashboardWidgetProjectParamsSchema = z.object({ projectId: z.string().min(1) });
export const dashboardWidgetParamsSchema = z.object({
  ...dashboardWidgetProjectParamsSchema.shape,
  widgetId: z.string().min(1),
});
