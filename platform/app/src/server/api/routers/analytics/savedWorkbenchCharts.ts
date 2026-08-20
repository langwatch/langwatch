/**
 * Saved workbench charts — the session-authenticated router the workbench calls.
 *
 * Thin by design. Every procedure does the same four things and nothing else:
 * check the member may do this, check the surface is switched on, resolve who
 * is asking, and hand the request to the service. The first two are declared
 * rather than written out — `checkProjectPermission` and
 * `enforceWorkbenchEnabled` are chained onto every procedure, so a sixth one
 * cannot be added with either quietly missing. The service is where a chart is
 * decided to be savable, and a second opinion at this layer could only ever
 * disagree with it.
 *
 * ## Why `definition` is `unknown` here
 *
 * The versioned definition schema lives with the service, which is the only
 * thing that writes a row. Re-declaring it in the input would put the same
 * decision in two places, and the moment they drift the router wins — admitting
 * a definition the service would refuse, or refusing one it would keep. The
 * service raises a `validation_error` carrying `meta.fieldErrors`, which is what
 * a form binds to, so nothing is lost by deciding it one layer down.
 *
 * @see ~/server/analytics/saved-workbench-charts — the service and its schema
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { z } from "zod";

import { SavedWorkbenchChartService } from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";

import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { getUserProtectionsForProject } from "../../utils";

import { enforceWorkbenchEnabled } from "./workbenchAccessMiddleware";

const projectScopeSchema = z.object({ projectId: z.string() });
const chartScopeSchema = projectScopeSchema.extend({ id: z.string() });

/** Request shape only — length, not meaning. */
const nameSchema = z.string().min(1).max(200);

/** Every saved workbench chart in the project. */
const getAll = protectedProcedure
  .input(projectScopeSchema)
  .permission("analytics:view")
  .use(enforceWorkbenchEnabled)
  .query(async ({ ctx, input }) => {
    return await SavedWorkbenchChartService.create(ctx.prisma).getAll({
      projectId: input.projectId,
    });
  });

/** One saved chart, with its query, parameters and specification. */
const getById = protectedProcedure
  .input(chartScopeSchema)
  .permission("analytics:view")
  .use(enforceWorkbenchEnabled)
  .query(async ({ ctx, input }) => {
    return await SavedWorkbenchChartService.create(ctx.prisma).getById({
      id: input.id,
      projectId: input.projectId,
    });
  });

/**
 * Saves a new chart.
 *
 * Handled errors propagate untouched: the tRPC boundary serialises a
 * `HandledError` into its code plus `meta` (`handledErrorMiddleware` in
 * `~/server/api/trpc`), and the workbench renders registry copy keyed by that
 * code. Catching and rewrapping here would replace a refusal the member can act
 * on — "this specification loads data over the network" — with one they cannot.
 */
const create = protectedProcedure
  .input(
    projectScopeSchema.extend({
      name: nameSchema,
      definition: z.unknown(),
    }),
  )
  .permission("analytics:create")
  .use(enforceWorkbenchEnabled)
  .mutation(async ({ ctx, input }) => {
    return await SavedWorkbenchChartService.create(ctx.prisma).createChart({
      projectId: input.projectId,
      protections: await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      }),
      input: { name: input.name, definition: input.definition },
    });
  });

/**
 * Replaces a saved chart's name, its definition, or both.
 *
 * The author's protections are resolved for *this* request rather than
 * remembered from the save, so a member whose permissions narrowed cannot
 * update a chart into naming a column they may no longer read.
 */
const update = protectedProcedure
  .input(
    chartScopeSchema.extend({
      name: nameSchema.optional(),
      definition: z.unknown().optional(),
    }),
  )
  .permission("analytics:update")
  .use(enforceWorkbenchEnabled)
  .mutation(async ({ ctx, input }) => {
    return await SavedWorkbenchChartService.create(ctx.prisma).updateChart({
      id: input.id,
      projectId: input.projectId,
      protections: await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      }),
      input: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.definition === undefined
          ? {}
          : { definition: input.definition }),
      },
    });
  });

const deleteChart = protectedProcedure
  .input(chartScopeSchema)
  .permission("analytics:delete")
  .use(enforceWorkbenchEnabled)
  .mutation(async ({ ctx, input }) => {
    await SavedWorkbenchChartService.create(ctx.prisma).deleteChart({
      id: input.id,
      projectId: input.projectId,
    });
    return { success: true };
  });

export const savedWorkbenchChartsRouter = createTRPCRouter({
  getAll,
  getById,
  create,
  update,
  delete: deleteChart,
});
