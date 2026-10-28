/**
 * Every `boards.*` procedure: the Dashboards area's boards (DashboardsV2), their scope and each
 * member's stars. The Analytics Reports boards are `dashboards.*`.
 * Spec: modules/dashboard/specs/dashboards-v2.feature.
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  boardTrpcRowSchema,
  boardTrpcSummarySchema,
  dashboardReorderResponseSchema,
} from "./dashboard.responses.ts";
import {
  boardExcludedOriginsSchema,
  dashboardDescriptionSchema,
  dashboardNameSchema,
  dashboardScopeImpactSchema,
  dashboardScopeProjectsSchema,
  dashboardScopeSchema,
  dashboardStarSchema,
  starredDashboardSchema,
} from "./dashboard.ts";

const projectScopeSchema = z.object({ projectId: z.string() });
const boardRefSchema = z.object({ ...projectScopeSchema.shape, dashboardId: z.string() });

export const boardTrpc = defineTrpcContract("boards")
  /** `_count.graphs` is the board's widgets. */
  .query("getAll")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      /** Also lists the Organization boards other projects own. */
      includeOrganization: z.boolean().optional(),
    }),
  )
  .withOutput(boardTrpcSummarySchema.array())

  .query("getById")
  .withInput(boardRefSchema)
  .withOutput(boardTrpcRowSchema)

  .mutation("create")
  .withInput(z.object({ ...projectScopeSchema.shape, name: z.string() }))
  .withOutput(boardTrpcRowSchema)

  /**
   * The board's inline name, description and left-out origins (`null` restores the default,
   * AC200); refused while `release_dashboards` is off.
   */
  .mutation("update")
  .withInput(
    z.object({
      ...boardRefSchema.shape,
      name: dashboardNameSchema.optional(),
      description: dashboardDescriptionSchema.nullable().optional(),
      excludedOrigins: boardExcludedOriginsSchema.nullable().optional(),
    }),
  )
  .withOutput(boardTrpcRowSchema)

  /** The board, its widgets and every star on it; a Reports board under the same id stays. */
  .mutation("delete")
  .withInput(boardRefSchema)
  .withOutput(boardTrpcRowSchema)

  /** Only the board's author changes its scope, in the project that owns it. */
  .mutation("setScope")
  .withInput(z.object({ ...boardRefSchema.shape, scope: dashboardScopeSchema }))
  .withOutput(boardTrpcRowSchema)

  /** What a narrower scope takes from other members; the author's to read. */
  .query("scopeImpact")
  .withInput(boardRefSchema)
  .withOutput(dashboardScopeImpactSchema)

  /** The projects an Organization board can be opened under by this reader. */
  .query("scopeProjects")
  .withInput(boardRefSchema)
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
  .build();
