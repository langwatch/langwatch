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
  dashboardDescriptionSchema,
  dashboardHomeProductSchema,
  dashboardNameSchema,
  dashboardProjectSchema,
  dashboardScopeImpactSchema,
  dashboardScopeProjectsSchema,
  dashboardScopeSchema,
  dashboardSidebarOrderIdsSchema,
  dashboardSidebarOrderSchema,
  dashboardStarSchema,
  organizationBoardSchema,
  starredDashboardSchema,
} from "./dashboard.ts";

const projectScopeSchema = z.object({ projectId: z.string() });
const organizationScopeSchema = z.object({ organizationId: z.string() });
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

  /**
   * Every board the member may see across the organization, the `/dashboards` library (ADR-002);
   * `dashboards_not_enabled` when no project of the organization has Dashboards on.
   */
  .query("listInOrganization")
  .withInput(organizationScopeSchema)
  .withOutput(organizationBoardSchema.array())

  /**
   * One board of the organization by id, by the library's rule (ADR-002, decision 3); any board
   * the member may not see, another organization's included, answers `dashboard_not_found`.
   */
  .query("resolve")
  .withInput(z.object({ ...organizationScopeSchema.shape, dashboardId: z.string() }))
  .withOutput(organizationBoardSchema)

  /**
   * The projects a board made outside a project view may be stored in: Dashboards on and
   * `analytics:create` held, by name. The browser picks the last-used one (ADR-002, decision 3).
   */
  .query("storeProjects")
  .withInput(organizationScopeSchema)
  .withOutput(dashboardProjectSchema.array())

  .query("getById")
  .withInput(boardRefSchema)
  .withOutput(boardTrpcRowSchema)

  /**
   * A new board at Project, homed in `homeProduct` (LLM Ops when absent); outside LLM Ops a
   * board cannot be Project, so `dashboard_home_needs_org_scope` (ADR-002, decision 8).
   */
  .mutation("create")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      name: z.string(),
      homeProduct: dashboardHomeProductSchema.optional(),
    }),
  )
  .withOutput(boardTrpcRowSchema)

  /**
   * A new board made at `scope` in one write. It asks what `create` and `setScope` ask
   * together, so a seat refused the scope is refused at the door and nothing is written.
   * `scope` Project outside LLM Ops is `dashboard_home_needs_org_scope`.
   */
  .mutation("createAtScope")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      name: z.string(),
      scope: dashboardScopeSchema,
      homeProduct: dashboardHomeProductSchema.optional(),
    }),
  )
  .withOutput(boardTrpcRowSchema)

  /** The board's inline name and description; refused while `release_dashboards` is off. */
  .mutation("update")
  .withInput(
    z.object({
      ...boardRefSchema.shape,
      name: dashboardNameSchema.optional(),
      description: dashboardDescriptionSchema.nullable().optional(),
    }),
  )
  .withOutput(boardTrpcRowSchema)

  /**
   * Rehomes a board, asked as `update` is in the project that owns it; the owning project never
   * changes. A Project board leaving LLM Ops becomes Only me, and only its author may move it
   * (`dashboard_scope_author_only`; ADR-002, decision 8). Answers the board as the library shows.
   */
  .mutation("move")
  .withInput(z.object({ ...boardRefSchema.shape, homeProduct: dashboardHomeProductSchema }))
  .withOutput(organizationBoardSchema)

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

  /** The member's own order of a product sidebar's Dashboards section here; none is empty. */
  .query("sidebarOrder")
  .withInput(
    z.object({ ...organizationScopeSchema.shape, homeProduct: dashboardHomeProductSchema }),
  )
  .withOutput(dashboardSidebarOrderSchema)

  /** Stores the member's own order of a product sidebar's Dashboards section, as given. */
  .mutation("reorderSidebar")
  .withInput(
    z.object({
      ...organizationScopeSchema.shape,
      homeProduct: dashboardHomeProductSchema,
      dashboardIds: dashboardSidebarOrderIdsSchema,
    }),
  )
  .withOutput(dashboardReorderResponseSchema)
  .build();
