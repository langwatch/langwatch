/**
 * Test suites over the process's tRPC transport.
 *
 * A test suite is a SimulationSuite with kind "test_suite": it groups scenarios
 * through Scenario.testSuiteId and runs them through the ordinary suite run
 * path. Mounted under `suites.testSuites.*`.
 *
 * @see specs/suites/test-suites.feature
 */
import { createTrpcService } from "@langwatch/api/trpc";
import {
  ScenarioTestSuiteNotFoundError,
  scenarioTestSuiteSchema,
} from "@langwatch/scenario-contract";
import { SuiteNotFoundError } from "@langwatch/suite-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { projectSchema } from "../../rules/suite-schemas.rules.ts";
import type { SuiteTrpcContext, SuiteTrpcProcedures } from "../../rules/suite-trpc-context.rules.ts";

export function createTestSuiteRouter<
  TContext extends SuiteTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: SuiteTrpcProcedures<TContext, TOptions, TRoot>,
) {
  const { protected: procedure, policy, validateOutput } = procedures;

  return createTrpcService({
    root: trpc,
    procedures: { protected: procedure, policy },
    validateOutput,
  })
    .mutation("create", (p) =>
      p
        .withInput(projectSchema.extend({ name: z.string().trim().min(1) }))
        .withOutput(scenarioTestSuiteSchema)
        .withPermission("scenarios:manage")
        .handle(async ({ ctx, input }) => ctx.app.suites.createTestSuite(input)),
    )
    .query("getAll", (p) =>
      p
        .withInput(projectSchema)
        .withOutput(scenarioTestSuiteSchema.array())
        .withPermission("scenarios:view")
        // scenarioIds is the reconciled member cache, which is what the UI reads.
        .handle(async ({ ctx, input }) => ctx.app.suites.listTestSuites(input)),
    )
    .mutation("rename", (p) =>
      p
        .withInput(
          projectSchema.extend({
            testSuiteId: z.string(),
            name: z.string().trim().min(1),
          }),
        )
        .withOutput(scenarioTestSuiteSchema)
        .withPermission("scenarios:manage")
        .handle(async ({ ctx, input }) => {
          try {
            return await ctx.app.suites.renameTestSuite(input);
          } catch (error) {
            if (error instanceof ScenarioTestSuiteNotFoundError) {
              throw new SuiteNotFoundError(input.testSuiteId);
            }
            throw error;
          }
        }),
    )
    .mutation("archive", (p) =>
      p
        .withInput(projectSchema.extend({ testSuiteId: z.string() }))
        .withOutput(scenarioTestSuiteSchema)
        .withPermission("scenarios:manage")
        .handle(async ({ ctx, input }) => {
          try {
            return await ctx.app.suites.archiveTestSuite(input);
          } catch (error) {
            if (error instanceof ScenarioTestSuiteNotFoundError) {
              throw new SuiteNotFoundError(input.testSuiteId);
            }
            throw error;
          }
        }),
    )
    .build();
}
