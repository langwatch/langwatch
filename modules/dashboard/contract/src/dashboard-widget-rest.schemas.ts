/**
 * The dashboard-widget REST family's wire shapes. Bounds mirror
 * `DashboardWidgetDefinition` in `@langwatch/analytics-contract/dashboard-widget-definition`.
 */
import { z } from "zod";

const MAX_WIDGET_NAME_LENGTH = 200;
const MAX_CODE_LENGTH = 200_000;
const MAX_QUERIES_PER_WIDGET = 8;
const MAX_QUERY_NAME_LENGTH = 64;
const QUERY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_QUERY_SQL_LENGTH = 50_000;
const MAX_PARAMETERS_PER_QUERY = 32;
const MAX_PARAMETER_VALUE_LENGTH = 4_000;

const dashboardWidgetNameSchema = z.string().min(1).max(MAX_WIDGET_NAME_LENGTH);
const dashboardWidgetCodeSchema = z.string().min(1).max(MAX_CODE_LENGTH);

const dashboardWidgetQueryParameterSchema = z.object({
  name: z.string().min(1).max(MAX_QUERY_NAME_LENGTH).regex(QUERY_NAME_PATTERN),
  type: z.enum(["string", "number", "boolean"]),
  default: z
    .union([z.string().max(MAX_PARAMETER_VALUE_LENGTH), z.number(), z.boolean()])
    .optional(),
});

const dashboardWidgetQuerySchema = z.object({
  name: z.string().min(1).max(MAX_QUERY_NAME_LENGTH).regex(QUERY_NAME_PATTERN),
  sql: z.string().min(1).max(MAX_QUERY_SQL_LENGTH),
  parameters: z.array(dashboardWidgetQueryParameterSchema).max(MAX_PARAMETERS_PER_QUERY).optional(),
});

const dashboardWidgetQueriesSchema = z
  .array(dashboardWidgetQuerySchema)
  .max(MAX_QUERIES_PER_WIDGET);

export const createDashboardWidgetSchema = z.object({
  name: dashboardWidgetNameSchema,
  code: dashboardWidgetCodeSchema,
  queries: dashboardWidgetQueriesSchema,
});

export const updateDashboardWidgetSchema = z
  .object({
    name: dashboardWidgetNameSchema.optional(),
    code: dashboardWidgetCodeSchema.optional(),
    queries: dashboardWidgetQueriesSchema.optional(),
  })
  // A PATCH naming nothing is a mistake worth reporting, and `code` without
  // `queries` (or the reverse) would write half a definition.
  .refine(
    (body) => body.name !== undefined || (body.code !== undefined && body.queries !== undefined),
    "Provide a name, a full { code, queries } definition, or both.",
  )
  .refine(
    (body) => (body.code === undefined) === (body.queries === undefined),
    "code and queries must be provided together.",
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
