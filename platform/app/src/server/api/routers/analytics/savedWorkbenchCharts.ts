/**
 * Saved workbench charts — the session-authenticated router the workbench calls.
 *
 * Thin by design. Every procedure does the same four things and nothing else:
 * check the member may do this, check the surface is switched on, resolve who
 * is asking, and hand the request to the service. The service is where a chart
 * is decided to be savable, and a second opinion at this layer could only ever
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
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";

import { GovernedSqlNotEnabledError } from "~/server/analytics/governed-sql/errors";
import { SavedWorkbenchChartService } from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";
import { workbenchEnabled } from "~/server/analytics/workbenchFeatureGate";

import { checkProjectPermission } from "../../rbac";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { getUserProtectionsForProject } from "../../utils";

const projectScopeSchema = z.object({ projectId: z.string() });
const chartScopeSchema = projectScopeSchema.extend({ id: z.string() });

/** Request shape only — length, not meaning. */
const nameSchema = z.string().min(1).max(200);

/**
 * Refuses unless the workbench switch is on for this member and project.
 *
 * Every procedure calls it, including the reads: a surface that listed charts
 * while it was switched off would be announcing a feature the same member
 * cannot use, and the flag is meant to hide the whole thing.
 */
async function requireWorkbenchEnabled({
  userId,
  projectId,
  prisma,
}: {
  userId: string;
  projectId: string;
  prisma: PrismaClient;
}): Promise<void> {
  if (!(await workbenchEnabled({ userId, projectId, prisma }))) {
    throw new GovernedSqlNotEnabledError();
  }
}

/** Every saved workbench chart in the project. */
const getAll = protectedProcedure
  .input(projectScopeSchema)
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ ctx, input }) => {
    await requireWorkbenchEnabled({
      userId: ctx.session.user.id,
      projectId: input.projectId,
      prisma: ctx.prisma,
    });
    return await SavedWorkbenchChartService.create(ctx.prisma).getAll({
      projectId: input.projectId,
    });
  });

/** One saved chart, with its query, parameters and specification. */
const getById = protectedProcedure
  .input(chartScopeSchema)
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ ctx, input }) => {
    await requireWorkbenchEnabled({
      userId: ctx.session.user.id,
      projectId: input.projectId,
      prisma: ctx.prisma,
    });
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
  .use(checkProjectPermission("analytics:create"))
  .mutation(async ({ ctx, input }) => {
    await requireWorkbenchEnabled({
      userId: ctx.session.user.id,
      projectId: input.projectId,
      prisma: ctx.prisma,
    });
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
  .use(checkProjectPermission("analytics:update"))
  .mutation(async ({ ctx, input }) => {
    await requireWorkbenchEnabled({
      userId: ctx.session.user.id,
      projectId: input.projectId,
      prisma: ctx.prisma,
    });
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
  .use(checkProjectPermission("analytics:delete"))
  .mutation(async ({ ctx, input }) => {
    await requireWorkbenchEnabled({
      userId: ctx.session.user.id,
      projectId: input.projectId,
      prisma: ctx.prisma,
    });
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
