/**
 * tRPC router for simulation suite configurations.
 *
 * Provides CRUD, duplicate, archive, and run endpoints.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runParameterValuesSchema } from "@langwatch/scenario-contract";
import type { SuiteRunSummary } from "~/server/scenarios/scenario-event.types";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import {
  createSuiteSchema,
  projectSchema,
  suiteTargetSchema,
  updateSuiteSchema,
} from "./schemas";

export const suiteRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createSuiteSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.suites.create(input);
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      return ctx.app.suites.list(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      return ctx.app.suites.get(input);
    }),

  update: protectedProcedure
    .input(updateSuiteSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.suites.update(input);
    }),

  duplicate: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.suites.duplicate(input);
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.suites.archive(input);
    }),

  resolveArchivedNames: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scenarioIds: z.array(z.string()),
        targets: z.array(suiteTargetSchema),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const project = await ctx.app.projects.tryGetWithTeam(input.projectId);
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }
      return ctx.app.suites.resolveArchivedNames({
        ...input,
        organizationId: project.team.organizationId,
      });
    }),

  run: protectedProcedure
    .input(
      projectSchema.extend({
        id: z.string(),
        idempotencyKey: z.string(),
        /** Optional client-generated batch run ID for immediate placeholder feedback */
        batchRunId: z.string().optional(),
        /**
         * Constant values applied to every scenario in the run. A value
         * supplied here overrides the scenario's own default for that name.
         */
        parameters: runParameterValuesSchema.optional(),
      }),
    )
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.app.projects.tryGetWithTeam(input.projectId);
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }

      // No catch: a Suite execution error is a HandledError, so the tRPC
      // handled-error middleware maps its code and status. Wrapping it in an
      // INTERNAL_SERVER_ERROR here would drop the `cause` the middleware keys
      // off, turning "every scenario is archived" — a customer-fault 422 the
      // UI has a specific recovery action for — into an opaque 500.
      const result = await ctx.app.suites.run({
        id: input.id,
        projectId: input.projectId,
        organizationId: project.team.organizationId,
        idempotencyKey: input.idempotencyKey,
        batchRunId: input.batchRunId,
        parameters: input.parameters,
      });

      return {
        scheduled: true,
        ...result,
      };
    }),

  getSummaries: protectedProcedure
    .input(
      projectSchema.extend({
        startDate: z.number().int().nonnegative().optional(),
        endDate: z.number().int().nonnegative().optional(),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const startDate = input.startDate ?? Date.now() - THIRTY_DAYS_MS;
      const endDate = input.endDate ?? Date.now();

      const summaries = await ctx.app.simulations.getInternalSuiteSummaries({
        projectId: input.projectId,
        startDate,
        endDate,
      });

      const result: Record<string, SuiteRunSummary> = {};
      for (const summary of summaries) {
        const suiteId = extractSuiteId(summary.scenarioSetId);
        if (!suiteId) continue;
        result[suiteId] = {
          passedCount: summary.passedCount,
          failedCount: summary.failedCount,
          totalCount: summary.totalCount,
          lastRunTimestamp: summary.lastRunTimestamp,
        };
      }
      return result;
    }),
});
