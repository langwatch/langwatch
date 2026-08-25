import { z } from "zod";

export const dashboardIdSchema = z.string().min(1);
export const projectIdSchema = z.string().min(1);
export const dashboardNameSchema = z.string().trim().min(1).max(255);

export const dashboardCreateInputSchema = z.object({
  projectId: projectIdSchema,
  name: dashboardNameSchema,
}).strict();

export const dashboardRenameInputSchema = dashboardCreateInputSchema.extend({
  dashboardId: dashboardIdSchema,
});

export const dashboardReorderInputSchema = z.object({
  projectId: projectIdSchema,
  dashboardIds: z.array(dashboardIdSchema).min(1),
}).strict();

export const dashboardSchema = z.object({
  id: dashboardIdSchema,
  projectId: projectIdSchema,
  name: dashboardNameSchema,
  order: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardSummarySchema = dashboardSchema.extend({
  graphCount: z.number().int().nonnegative(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
