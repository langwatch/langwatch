/**
 * Test suites over the process's tRPC transport.
 *
 * A test suite is a SimulationSuite with kind "test_suite": it groups scenarios
 * through Scenario.testSuiteId and runs them through the ordinary suite run
 * path. Mounted under `suites.testSuites.*`.
 *
 * @see specs/suites/test-suites.feature
 */
import { ScenarioTestSuiteNotFoundError } from "@langwatch/scenario-contract";
import { SuiteNotFoundError } from "@langwatch/suite-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { projectSchema } from "./suite.schemas";
import type { SuiteTrpcContext, SuiteTrpcProcedures } from "./suite.trpc-context";

export function createTestSuiteRouter<
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
      return ctx.app.suites.createTestSuite(input);
    }),

    getAll: policy("scenarios:view")(procedure.input(projectSchema)).query(
      async ({ ctx, input }) => {
        // scenarioIds is the reconciled member cache, which is what the UI reads.
        return await ctx.app.suites.listTestSuites(input);
      },
    ),

    rename: policy("scenarios:manage")(
      procedure.input(
        projectSchema.extend({
          testSuiteId: z.string(),
          name: z.string().trim().min(1),
        }),
      ),
    ).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.suites.renameTestSuite(input);
      } catch (error) {
        if (error instanceof ScenarioTestSuiteNotFoundError) {
          throw new SuiteNotFoundError(input.testSuiteId);
        }
        throw error;
      }
    }),

    archive: policy("scenarios:manage")(
      procedure.input(projectSchema.extend({ testSuiteId: z.string() })),
    ).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.suites.archiveTestSuite(input);
      } catch (error) {
        if (error instanceof ScenarioTestSuiteNotFoundError) {
          throw new SuiteNotFoundError(input.testSuiteId);
        }
        throw error;
      }
    }),
  });
}
