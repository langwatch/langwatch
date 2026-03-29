/**
 * tRPC router for simulation suite configurations.
 *
 * Provides CRUD, duplicate, archive, and run endpoints.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { SuiteService } from "~/server/suites/suite.service";
import { SuiteDomainError } from "~/server/suites/errors";
import { ProjectRepository } from "~/server/projects/project.repository";
import { SimulationFacade } from "~/server/simulations/simulation.facade";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import type { SuiteRunSummary } from "~/server/scenarios/scenario-event.types";
import { checkProjectPermission } from "../../rbac";
import { createSuiteSchema, projectSchema, suiteTargetSchema, updateSuiteSchema } from "./schemas";

export const suiteRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createSuiteSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create({ prisma: ctx.prisma, suiteRunService: getApp().suiteRuns.runs });
      return service.create(input);
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = SuiteService.create({ prisma: ctx.prisma, suiteRunService: getApp().suiteRuns.runs });
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = SuiteService.create({ prisma: ctx.prisma, suiteRunService: getApp().suiteRuns.runs });
      const suite = await service.getById(input);
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return suite;
    }),

  update: protectedProcedure
    .input(updateSuiteSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const { id, projectId, ...data } = input;
      const service = SuiteService.create({ prisma: ctx.prisma, suiteRunService: getApp().suiteRuns.runs });
      return service.update({ id, projectId, data });
    }),

  duplicate: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create({ prisma: ctx.prisma, suiteRunService: getApp().suiteRuns.runs });
      try {
        return await service.duplicate(input);
      } catch (error) {
        if (error instanceof SuiteDomainError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw error;
      }
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create({ prisma: ctx.prisma, suiteRunService: getApp().suiteRuns.runs });
      const result = await service.archive(input);
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return result;
    }),

  resolveArchivedNames: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scenarioIds: z.array(z.string()),
        targets: z.array(suiteTargetSchema),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const projectRepository = new ProjectRepository(ctx.prisma);
      const organizationId = await projectRepository.getOrganizationId({
        projectId: input.projectId,
      });
      if (!organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }
      const service = SuiteService.create({ prisma: ctx.prisma, suiteRunService: getApp().suiteRuns.runs });
      return service.resolveArchivedNames({
        ...input,
        organizationId,
      });
    }),

  run: protectedProcedure
    .input(projectSchema.extend({
      id: z.string(),
      idempotencyKey: z.string(),
    }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create({ prisma: ctx.prisma, suiteRunService: getApp().suiteRuns.runs });
      const suite = await service.getById(input);
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }

      const projectRepository = new ProjectRepository(ctx.prisma);
      const organizationId = await projectRepository.getOrganizationId({
        projectId: input.projectId,
      });
      if (!organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }

      try {
        const result = await service.run({
          suite,
          projectId: input.projectId,
          organizationId,
          idempotencyKey: input.idempotencyKey,
        });

        return {
          scheduled: true,
          ...result,
        };
      } catch (error) {
        if (error instanceof SuiteDomainError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        const message =
          error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  getSummaries: protectedProcedure
    .input(
      projectSchema.extend({
        startDate: z.number().int().nonnegative().optional(),
        endDate: z.number().int().nonnegative().optional(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const startDate = input.startDate ?? Date.now() - THIRTY_DAYS_MS;
      const endDate = input.endDate ?? Date.now();

      const facade = SimulationFacade.create();
      const summaries = await facade.getInternalSuiteSummaries({
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
