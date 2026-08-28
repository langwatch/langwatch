/**
 * tRPC router for test suite folders.
 *
 * A folder is a SimulationSuite with kind "folder": it groups scenarios
 * through Scenario.folderId and runs them through the ordinary suite run
 * path. Mounted under `suites.folders.*`.
 *
 * @see specs/suites/suite-folders.feature
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

export const folderRouter = createTRPCRouter({
  create: protectedProcedure
    .input(projectSchema.extend({ name: z.string().trim().min(1) }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      return service.createFolder(input);
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      const folders = await service.getAllFolders(input);
      // scenarioIds is the reconciled member cache; exposed as caseIds so the
      // UI reads the concept it renders.
      return folders.map((folder) => ({
        ...folder,
        caseIds: folder.scenarioIds,
      }));
    }),

  rename: protectedProcedure
    .input(
      projectSchema.extend({
        folderId: z.string(),
        name: z.string().trim().min(1),
      }),
    )
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      return service.renameFolder(input);
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ folderId: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      return service.archiveFolder(input);
    }),
});
