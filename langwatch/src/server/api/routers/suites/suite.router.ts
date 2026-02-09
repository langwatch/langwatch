/**
 * tRPC router for simulation suite configurations.
 *
 * Provides CRUD, duplicate, delete, and run endpoints.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { SuiteService } from "~/server/suites/suite.service";
import { checkProjectPermission } from "../../rbac";
import { createSuiteSchema, projectSchema, updateSuiteSchema } from "./schemas";

export const suiteRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createSuiteSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.fromPrisma(ctx.prisma);
      return service.create(input);
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = SuiteService.fromPrisma(ctx.prisma);
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = SuiteService.fromPrisma(ctx.prisma);
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
      const service = SuiteService.fromPrisma(ctx.prisma);
      return service.update({ id, projectId, data });
    }),

  duplicate: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.fromPrisma(ctx.prisma);
      try {
        return await service.duplicate(input);
      } catch {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
    }),

  delete: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.fromPrisma(ctx.prisma);
      const result = await service.delete(input);
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return result;
    }),

  run: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.fromPrisma(ctx.prisma);
      const suite = await service.getById(input);
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }

      try {
        const result = await service.run({
          suite,
          projectId: input.projectId,
          deps: {
            validateScenarioExists: async ({ id, projectId }) => {
              const scenario = await ctx.prisma.scenario.findFirst({
                where: { id, projectId, archivedAt: null },
              });
              return scenario !== null;
            },
            validateTargetExists: async ({ referenceId, type, projectId }) => {
              if (type === "prompt") {
                const prompt = await ctx.prisma.llmPromptConfig.findFirst({
                  where: { id: referenceId, projectId },
                });
                return prompt !== null;
              }
              if (type === "http") {
                const agent = await ctx.prisma.agent.findFirst({
                  where: { id: referenceId, projectId, archivedAt: null },
                });
                return agent !== null;
              }
              return false;
            },
          },
        });

        return {
          scheduled: true,
          ...result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),
});
