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
import { checkProjectPermission } from "../../rbac";
import { createSuiteSchema, projectSchema, updateSuiteSchema } from "./schemas";

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

  getQueueStatus: protectedProcedure
    .input(projectSchema.extend({ suiteId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      // Verify suite belongs to the authorized project
      const service = SuiteService.create(ctx.prisma);
      const suite = await service.getById({
        id: input.suiteId,
        projectId: input.projectId,
      });
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return SuiteService.getQueueStatus({ suiteId: input.suiteId });
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

      try {
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
});
