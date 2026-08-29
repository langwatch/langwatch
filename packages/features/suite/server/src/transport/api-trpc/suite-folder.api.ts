/**
 * Test-suite folders over the process's tRPC transport.
 *
 * A folder is a SimulationSuite with kind "folder": it groups scenarios
 * through Scenario.folderId and runs them through the ordinary suite run
 * path. Mounted under `suites.folders.*`.
 *
 * @see specs/suites/suite-folders.feature
 */
import { ScenarioFolderNotFoundError } from "@langwatch/scenario-contract";
import { SuiteNotFoundError } from "@langwatch/suite-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { projectSchema } from "./suite.schemas";
import type { SuiteTrpcContext, SuiteTrpcProcedures } from "./suite.trpc-context";

export function createSuiteFolderRouter<
  TContext extends SuiteTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: SuiteTrpcProcedures<TContext, TOptions, TRoot>,
) {
  const { protected: procedure, policy } = procedures;

  return trpc.router({
    create: policy("scenarios:manage")(
      procedure.input(projectSchema.extend({ name: z.string().trim().min(1) })),
    ).mutation(async ({ ctx, input }) => {
      return ctx.app.suites.createFolder(input);
    }),

    getAll: policy("scenarios:view")(procedure.input(projectSchema)).query(
      async ({ ctx, input }) => {
        const folders = await ctx.app.suites.listFolders(input);
        // scenarioIds is the reconciled member cache; exposed as caseIds so the
        // UI reads the concept it renders.
        return folders.map((folder) => ({
          ...folder,
          caseIds: folder.scenarioIds,
        }));
      },
    ),

    rename: policy("scenarios:manage")(
      procedure.input(
        projectSchema.extend({
          folderId: z.string(),
          name: z.string().trim().min(1),
        }),
      ),
    ).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.suites.renameFolder(input);
      } catch (error) {
        if (error instanceof ScenarioFolderNotFoundError) {
          throw new SuiteNotFoundError(input.folderId);
        }
        throw error;
      }
    }),

    archive: policy("scenarios:manage")(
      procedure.input(projectSchema.extend({ folderId: z.string() })),
    ).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.suites.archiveFolder(input);
      } catch (error) {
        if (error instanceof ScenarioFolderNotFoundError) {
          throw new SuiteNotFoundError(input.folderId);
        }
        throw error;
      }
    }),
  });
}
