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
import { ScenarioFolderNotFoundError } from "@langwatch/scenario-contract";
import { SuiteNotFoundError } from "@langwatch/suite-contract";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { projectSchema } from "./schemas";

export const folderRouter = createTRPCRouter({
  create: protectedProcedure
    .input(projectSchema.extend({ name: z.string().trim().min(1) }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.scenarios.createFolder(input);
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const folders = await ctx.app.scenarios.listFolders(input);
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
      try {
        return await ctx.app.scenarios.renameFolder(input);
      } catch (error) {
        if (error instanceof ScenarioFolderNotFoundError) {
          throw new SuiteNotFoundError(input.folderId);
        }
        throw error;
      }
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ folderId: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.scenarios.archiveFolder(input);
      } catch (error) {
        if (error instanceof ScenarioFolderNotFoundError) {
          throw new SuiteNotFoundError(input.folderId);
        }
        throw error;
      }
    }),
});
