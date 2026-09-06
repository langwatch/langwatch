/**
 * tRPC router for test suites.
 *
 * A test suite is a SimulationSuite with kind "test_suite": it groups scenarios
 * through Scenario.testSuiteId and runs them through the ordinary suite run
 * path. Mounted under `suites.testSuites.*`.
 *
 * @see specs/suites/test-suites.feature
 */

import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { SuiteService } from "~/server/suites/suite.service";
import { projectSchema } from "./schemas";

function createSuiteService(prisma: PrismaClient) {
  return SuiteService.create({
    prisma,
    suiteRunService: getApp().suiteRuns.runs,
  });
}

export const testSuiteRouter = createTRPCRouter({
  create: protectedProcedure
    .input(projectSchema.extend({ name: z.string().trim().min(1) }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      return service.createTestSuite(input);
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      // scenarioIds is the reconciled member cache, which is what the UI reads.
      return service.getAllTestSuites(input);
    }),

  rename: protectedProcedure
    .input(
      projectSchema.extend({
        testSuiteId: z.string(),
        name: z.string().trim().min(1),
      }),
    )
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      return service.renameTestSuite(input);
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ testSuiteId: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      return service.archiveTestSuite(input);
    }),
});
