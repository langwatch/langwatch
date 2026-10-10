import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The house id scheme's kind for a dashboard. */
export const DASHBOARD_KSUID_RESOURCE = "dashboard";

export const dashboardIdSchema = z.string().min(1);
export const projectIdSchema = z.string().min(1);
export const dashboardNameSchema = z.string().trim().min(1).max(255);

const dashboardCreateInputSchemaDefinition = z
  .object({
    projectId: projectIdSchema,
    name: dashboardNameSchema,
  })
  .strict();
export interface DashboardCreateInputSchema extends Named<
  typeof dashboardCreateInputSchemaDefinition
> {}
export const dashboardCreateInputSchema: DashboardCreateInputSchema =
  dashboardCreateInputSchemaDefinition;

const dashboardRenameInputSchemaDefinition = z
  .object({ ...dashboardCreateInputSchema.shape, dashboardId: dashboardIdSchema })
  .strict();
export interface DashboardRenameInputSchema extends Named<
  typeof dashboardRenameInputSchemaDefinition
> {}
export const dashboardRenameInputSchema: DashboardRenameInputSchema =
  dashboardRenameInputSchemaDefinition;

const dashboardReorderInputSchemaDefinition = z
  .object({
    projectId: projectIdSchema,
    dashboardIds: z.array(dashboardIdSchema).min(1),
  })
  .strict();
export interface DashboardReorderInputSchema extends Named<
  typeof dashboardReorderInputSchemaDefinition
> {}
export const dashboardReorderInputSchema: DashboardReorderInputSchema =
  dashboardReorderInputSchemaDefinition;

const dashboardSchemaDefinition = z
  .object({
    id: dashboardIdSchema,
    projectId: projectIdSchema,
    name: dashboardNameSchema,
    order: z.number().int().nonnegative(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface DashboardSchema extends Named<typeof dashboardSchemaDefinition> {}
export const dashboardSchema: DashboardSchema = dashboardSchemaDefinition;
export type Dashboard = z.infer<typeof dashboardSchema>;

const dashboardSummarySchemaDefinition = z
  .object({ ...dashboardSchema.shape, graphCount: z.number().int().nonnegative() })
  .strict();
export interface DashboardSummarySchema extends Named<typeof dashboardSummarySchemaDefinition> {}
export const dashboardSummarySchema: DashboardSummarySchema = dashboardSummarySchemaDefinition;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

// -- what `/api/dashboards` accepts ------------------------------------------

const dashboardRestNameSchemaDefinition = z.object({
  name: z.string().min(1, "name is required").max(255),
});
export interface DashboardRestNameSchema extends Named<typeof dashboardRestNameSchemaDefinition> {}
export const dashboardRestNameSchema: DashboardRestNameSchema = dashboardRestNameSchemaDefinition;

const dashboardRestReorderSchemaDefinition = z.object({
  dashboardIds: z.array(z.string().min(1)).min(1, "dashboardIds must not be empty"),
});
export interface DashboardRestReorderSchema extends Named<
  typeof dashboardRestReorderSchemaDefinition
> {}
export const dashboardRestReorderSchema: DashboardRestReorderSchema =
  dashboardRestReorderSchemaDefinition;

const dashboardRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface DashboardRestParamsSchema extends Named<
  typeof dashboardRestParamsSchemaDefinition
> {}
export const dashboardRestParamsSchema: DashboardRestParamsSchema =
  dashboardRestParamsSchemaDefinition;
