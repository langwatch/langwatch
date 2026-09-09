import { z } from "zod";

/** The house id scheme's kind for a dashboard. */
export const DASHBOARD_KSUID_RESOURCE = "dashboard";

export const dashboardIdSchema = z.string().min(1);
export const projectIdSchema = z.string().min(1);
export const dashboardNameSchema = z.string().trim().min(1).max(255);

export const dashboardCreateInputSchema = z
  .object({
    projectId: projectIdSchema,
    name: dashboardNameSchema,
  })
  .strict();

export const dashboardRenameInputSchema = z
  .object({ ...dashboardCreateInputSchema.shape, dashboardId: dashboardIdSchema })
  .strict();

export const dashboardReorderInputSchema = z
  .object({
    projectId: projectIdSchema,
    dashboardIds: z.array(dashboardIdSchema).min(1),
  })
  .strict();

export const dashboardSchema = z
  .object({
    id: dashboardIdSchema,
    projectId: projectIdSchema,
    name: dashboardNameSchema,
    order: z.number().int().nonnegative(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardSummarySchema = z
  .object({ ...dashboardSchema.shape, graphCount: z.number().int().nonnegative() })
  .strict();
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

// -- what `/api/dashboards` accepts ------------------------------------------

export const dashboardRestNameSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

export const dashboardRestReorderSchema = z.object({
  dashboardIds: z.array(z.string().min(1)).min(1, "dashboardIds must not be empty"),
});

export const dashboardRestParamsSchema = z.object({ id: z.string().min(1) });
