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

import {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "~/server/analytics/lwql/timeWindowSchema";
import { SavedWorkbenchChartService } from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";

import { createTRPCRouter, protectedProcedure } from "../../trpc";

import { resolveLangWatchQLCaller } from "./lwqlCaller";
import { enforceWorkbenchEnabled } from "./workbenchAccessMiddleware";

const projectScopeSchema = z.object({ projectId: z.string() });
const chartScopeSchema = projectScopeSchema.extend({ id: z.string() });

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
 * Runs one saved chart and returns its result.
 *
 * A sibling of `getById` rather than a new surface — running is reading with
 * execution attached — chained through the same permission and switch gates as
 * every other procedure here. The period and the datapoint step are supplied by
 * this request, never read out of the stored definition: they are the surface's
 * to set, which is the whole reserved-parameter contract. Handled errors
 * propagate untouched, like on `getById`: the boundary serialises their code plus
 * `meta`, and the workbench renders registry copy keyed by that code — including
 * `lwql_granularity_too_fine`'s bucket arithmetic.
 *
 * `onBudgetOverflow` defaults to refusing, so every existing caller keeps the
 * behaviour it had. A dashboard widget passes `"coarsen"` because its saved
 * step meets whatever period the dashboard's control is set to: refusing there
 * would blank a card whose owner changed nothing. The substitution is reported
 * back as `coarsenedFromSeconds` rather than applied silently.
 */
const run = protectedProcedure
  .input(
    chartScopeSchema.extend({
      timeWindow: lwqlTimeWindowSchema.optional(),
      /**
       * The datapoint step, in seconds — restricted to the offered steps
       * ({@link lwqlGranularityStepSchema}) so an off-list value is a schema
       * rejection here rather than reaching the service's backstop.
       */
      granularitySeconds: lwqlGranularityStepSchema.optional(),
      onBudgetOverflow: z.enum(["refuse", "coarsen"]).optional(),
    }),
  )
  .permission("analytics:view")
  .use(enforceWorkbenchEnabled)
  .mutation(async ({ ctx, input }) => {
    const { project, protections } = await resolveLangWatchQLCaller({
      ctx,
      projectId: input.projectId,
    });

    return SavedWorkbenchChartService.create(ctx.prisma).runChart({
      id: input.id,
      projectId: input.projectId,
      project,
      protections,
      input: {
        ...(input.timeWindow ? { timeWindow: input.timeWindow } : {}),
        ...(input.granularitySeconds === undefined
          ? {}
          : { granularitySeconds: input.granularitySeconds }),
        ...(input.onBudgetOverflow
          ? { onBudgetOverflow: input.onBudgetOverflow }
          : {}),
      },
    });
  });

export const savedWorkbenchChartsRouter = createTRPCRouter({
  getById,
  run,
});
