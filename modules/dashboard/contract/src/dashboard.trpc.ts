/**
 * Every `dashboards.*` procedure, declared once: the Analytics Reports boards, which have no
 * scope, and the Flight Deck's source presence. The Dashboards area's boards are `boards.*`.
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
import { dashboardSourcePresenceSchema } from "./dashboard.ts";

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
  .withInput(projectScopeSchema)
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

  /** Cascades to the board's charts; the Dashboards area's boards and stars stay. */
  .mutation("delete")
  .withInput(dashboardRefSchema)
  .withOutput(dashboardTrpcRowSchema)

  /** Legacy board ordering, kept for the Analytics reports section only. */
  .mutation("reorderDashboards")
  .withInput(z.object({ ...projectScopeSchema.shape, dashboardIds: z.array(z.string()) }))
  .withOutput(dashboardReorderResponseSchema)

  /** The first dashboard, created on demand; `null` on an aggregate with none, as on main. */
  .query("getOrCreateFirst")
  .withInput(projectScopeSchema)
  .withOutput(dashboardTrpcRowSchema.nullable())

  /** Per Flight Deck source, whether the project ever recorded a row. */
  .query("sourcePresence")
  .withInput(projectScopeSchema)
  .withOutput(dashboardSourcePresenceSchema)
  .build();
