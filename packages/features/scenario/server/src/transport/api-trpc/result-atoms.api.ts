/**
 * The Results tab's reads, over the process's tRPC transport.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import {
  codeScenarioSchema,
  resultAtomsPageSchema,
  resultsOverviewSchema,
  runTargetSchema,
  type ResultsFilter,
} from "@langwatch/scenario-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { MAX_ATOM_PAGE } from "../../ports/result-atoms-read.port.ts";
import type {
  ScenarioTrpcContext,
  ScenarioTrpcProcedures,
} from "../../rules/scenario-trpc-context.rules.ts";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What the Results tab is showing. `endDate` is optional on purpose. The period picker pins its end
 * at mount, so a live view sends only `startDate` and a run that begins while the page is open
 * still lands in the window. A snapshot, such as an export, sends both.
 */
const resultsFilterSchema = z.object({
  projectId: z.string(),
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
  scenarioIds: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  testSuiteIds: z.array(z.string()).optional(),
  scenarioSetIds: z.array(z.string()).optional(),
  targetKeys: z.array(z.string()).optional(),
  outcome: z.enum(["passed", "failed", "pending"]).optional(),
});

function toFilter(input: z.infer<typeof resultsFilterSchema>): ResultsFilter {
  return { ...input, startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS };
}

/** The window alone: the scenario filter lists what the window holds. */
const windowSchema = z.object({
  projectId: z.string(),
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
});

export function createResultAtomsRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: ScenarioTrpcProcedures<TContext, TOptions, TRoot>,
) {
  const { protected: procedure, policy, validateOutput } = procedures;

  return (
    createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * The scenarios that ran from code inside the window, for the scenario
       * filter. They have no row in Postgres, so the stored scenario list cannot
       * name them.
       */
      .query("getCodeScenarios", (p) =>
        p
          .withInput(windowSchema)
          .withOutput(codeScenarioSchema.array())
          .withPermission("scenarios:view")
          .handle(async ({ ctx, input }) => {
            return ctx.app.scenarios.getCodeScenarios({
              projectId: input.projectId,
              startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
              endDate: input.endDate,
            });
          }),
      )
      /**
       * The targets the window names that the agent and prompt lists cannot, for
       * the target filter: those a run from code named, and the parameter
       * variants of stored targets. Neither has a row of its own in Postgres.
       */
      .query("getRunTargets", (p) =>
        p
          .withInput(windowSchema)
          .withOutput(runTargetSchema.array())
          .withPermission("scenarios:view")
          .handle(async ({ ctx, input }) => {
            return ctx.app.scenarios.getRunTargets({
              projectId: input.projectId,
              startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
              endDate: input.endDate,
            });
          }),
      )
      /**
       * The stat strip and the group rows for one grouping, aggregated in the database.
       */
      .query("getResultsOverview", (p) =>
        p
          .withInput(
            resultsFilterSchema.extend({ groupBy: z.enum(["plan", "scenario", "target", "none"]) }),
          )
          .withOutput(resultsOverviewSchema)
          .withPermission("scenarios:view")
          .handle(async ({ ctx, input }) => {
            const { groupBy, ...filter } = input;
            return ctx.app.scenarios.getResultsOverview({ filter: toFilter(filter), groupBy });
          }),
      )
      /**
       * One page of atoms, newest first. This is the drill-down: opening one group, or the flat list
       * once a filter has already narrowed the question.
       */
      .query("getResultAtoms", (p) =>
        p
          .withInput(
            resultsFilterSchema.extend({
              limit: z.number().int().min(1).max(MAX_ATOM_PAGE).default(100),
              cursor: z.string().optional(),
            }),
          )
          .withOutput(resultAtomsPageSchema)
          .withPermission("scenarios:view")
          .handle(async ({ ctx, input }) => {
            const { limit, cursor, ...filter } = input;
            return ctx.app.scenarios.getResultAtoms({ filter: toFilter(filter), limit, cursor });
          }),
      )
      .build()
  );
}
