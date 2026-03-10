/**
 * tRPC router for simulation suite configurations.
 *
 * Provides CRUD, duplicate, archive, and run endpoints.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { SuiteService } from "~/server/suites/suite.service";
import { SuiteDomainError } from "~/server/suites/errors";
import { ProjectRepository } from "~/server/projects/project.repository";
import { scenarioQueue } from "~/server/scenarios/scenario.queue";
import { checkProjectPermission } from "../../rbac";
import { createSuiteSchema, projectSchema, suiteTargetSchema, updateSuiteSchema } from "./schemas";

export const suiteRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createSuiteSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
      return service.create(input);
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
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
      const service = SuiteService.create(ctx.prisma);
      return service.update({ id, projectId, data });
    }),

  duplicate: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
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
      const service = SuiteService.create(ctx.prisma);
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
      const service = SuiteService.create(ctx.prisma);
      return service.resolveArchivedNames({
        ...input,
        organizationId,
      });
    }),

  run: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
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

  /**
   * Get queue status for a suite's scenario jobs.
   *
   * Returns waiting and active job counts for the scenario queue.
   * Used by the frontend to show a banner when jobs are pending.
   */
  getQueueStatus: protectedProcedure
    .input(projectSchema.extend({ suiteId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async () => {
      const [waiting, active] = await Promise.all([
        scenarioQueue.getWaitingCount(),
        scenarioQueue.getActiveCount(),
      ]);
      return { waiting, active };
    }),
});
