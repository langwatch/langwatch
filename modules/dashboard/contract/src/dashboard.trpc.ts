/**
 * Every `dashboards.*` procedure, declared once: its name, its kind, what it
 * takes and what it answers.
 * Spec: modules/dashboard/specs/dashboard-service.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  dashboardReorderResponseSchema,
  dashboardTrpcDetailSchema,
  dashboardTrpcRowSchema,
  dashboardTrpcSummarySchema,
} from "./dashboard.responses.ts";
import {
  dashboardDescriptionSchema,
  dashboardNameSchema,
  dashboardSourcePresenceSchema,
  dashboardVisibilitySchema,
} from "./dashboard.ts";

const projectScopeSchema = z.object({ projectId: z.string() });
const dashboardScopeSchema = z.object({
  ...projectScopeSchema.shape,
  dashboardId: z.string(),
});

export const dashboardTrpc = defineTrpcContract("dashboards")
  /**
   * The card count is builder graphs only, matching the detail read below: a
   * count that included workbench charts would promise cards the grid never
   * draws. `_count.graphs` is the shape the pages have always read.
   */
  .query("getAll")
  .withInput(projectScopeSchema)
  .withOutput(dashboardTrpcSummarySchema.array())

  .query("getById")
  .withInput(dashboardScopeSchema)
  .withOutput(dashboardTrpcDetailSchema)

  .mutation("create")
  .withInput(z.object({ ...projectScopeSchema.shape, name: z.string() }))
  .withOutput(dashboardTrpcRowSchema)

  .mutation("rename")
  .withInput(z.object({ ...dashboardScopeSchema.shape, name: z.string() }))
  .withOutput(dashboardTrpcRowSchema)

  /** Cascades to the dashboard's graphs. */
  .mutation("delete")
  .withInput(dashboardScopeSchema)
  .withOutput(dashboardTrpcRowSchema)

  .mutation("reorderDashboards")
  .withInput(z.object({ ...projectScopeSchema.shape, dashboardIds: z.array(z.string()) }))
  .withOutput(dashboardReorderResponseSchema)

  /** Every project has at least one dashboard once this has been asked. */
  .query("getOrCreateFirst")
  .withInput(projectScopeSchema)
  .withOutput(dashboardTrpcRowSchema)

  /**
   * Dashboards area only, like the two below: refused while `release_dashboards`
   * is off. The board's inline name and description.
   */
  .mutation("updateDetails")
  .withInput(
    z.object({
      ...dashboardScopeSchema.shape,
      name: dashboardNameSchema.optional(),
      description: dashboardDescriptionSchema.nullable().optional(),
    }),
  )
  .withOutput(dashboardTrpcRowSchema)

  /** The creator or an admin; for a board older than creators, anyone who may edit. */
  .mutation("setVisibility")
  .withInput(z.object({ ...dashboardScopeSchema.shape, visibility: dashboardVisibilitySchema }))
  .withOutput(dashboardTrpcRowSchema)

  /** Per Flight Deck source, whether the project ever recorded a row. */
  .query("sourcePresence")
  .withInput(projectScopeSchema)
  .withOutput(dashboardSourcePresenceSchema)
  .build();
