/**
 * Every `dashboards.*` procedure, declared once: its name, its kind, what it
 * takes and what it answers.
 * Spec: modules/dashboard/specs/dashboard-service.feature.
 */
import { defineTrpcContract } from "@langwatch/module";
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
  dashboardScopeImpactSchema,
  dashboardScopeProjectsSchema,
  dashboardScopeSchema,
  dashboardSourcePresenceSchema,
  dashboardStarSchema,
  starredDashboardSchema,
} from "./dashboard.ts";

const projectScopeSchema = z.object({ projectId: z.string() });
const dashboardRefSchema = z.object({
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
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      /** Also lists the Organization boards other projects own; only the Dashboards area asks. */
      includeOrganization: z.boolean().optional(),
    }),
  )
  .withOutput(dashboardTrpcSummarySchema.array())

  .query("getById")
  .withInput(dashboardRefSchema)
  .withOutput(dashboardTrpcDetailSchema)

  .mutation("create")
  .withInput(z.object({ ...projectScopeSchema.shape, name: z.string() }))
  .withOutput(dashboardTrpcRowSchema)

  .mutation("rename")
  .withInput(z.object({ ...dashboardRefSchema.shape, name: z.string() }))
  .withOutput(dashboardTrpcRowSchema)

  /** Cascades to the dashboard's graphs, and removes it from everyone's stars. */
  .mutation("delete")
  .withInput(dashboardRefSchema)
  .withOutput(dashboardTrpcRowSchema)

  /**
   * Legacy board ordering, kept for the Analytics reports section only; the
   * Dashboards feature orders by a member's favourites. Remove with that section.
   */
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
      ...dashboardRefSchema.shape,
      name: dashboardNameSchema.optional(),
      description: dashboardDescriptionSchema.nullable().optional(),
    }),
  )
  .withOutput(dashboardTrpcRowSchema)

  /** Dashboards area. Only the board's author changes its scope, in the project that owns it. */
  .mutation("setScope")
  .withInput(z.object({ ...dashboardRefSchema.shape, scope: dashboardScopeSchema }))
  .withOutput(dashboardTrpcRowSchema)

  /** Dashboards area. What a narrower scope takes from other members; the author's to read. */
  .query("scopeImpact")
  .withInput(dashboardRefSchema)
  .withOutput(dashboardScopeImpactSchema)

  /** Dashboards area. The projects an Organization board can be opened under by this reader. */
  .query("scopeProjects")
  .withInput(dashboardRefSchema)
  .withOutput(dashboardScopeProjectsSchema)

  /** The member's stars for this project, boards and templates, in their own order. */
  .query("listStarred")
  .withInput(projectScopeSchema)
  .withOutput(starredDashboardSchema.array())

  /** Stars a board or a template for the acting member; appends at the end, idempotent. */
  .mutation("star")
  .withInput(z.object({ ...projectScopeSchema.shape, star: dashboardStarSchema }))
  .withOutput(dashboardReorderResponseSchema)

  .mutation("unstar")
  .withInput(z.object({ ...projectScopeSchema.shape, star: dashboardStarSchema }))
  .withOutput(dashboardReorderResponseSchema)

  /** Rewrites the member's star order from the stars given, in the order given. */
  .mutation("reorderStars")
  .withInput(z.object({ ...projectScopeSchema.shape, stars: z.array(dashboardStarSchema) }))
  .withOutput(dashboardReorderResponseSchema)

  /** Per Flight Deck source, whether the project ever recorded a row. */
  .query("sourcePresence")
  .withInput(projectScopeSchema)
  .withOutput(dashboardSourcePresenceSchema)
  .build();
