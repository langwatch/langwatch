import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import type { ResultsFilter } from "~/server/app-layer/simulations/result-atoms/atom.types";
import { MAX_ATOM_PAGE } from "~/server/app-layer/simulations/result-atoms/result-atoms.clickhouse.repository";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What the Results tab is showing.
 *
 * `endDate` is optional on purpose. The period picker pins its end at mount,
 * so a live view sends only `startDate` and a run that begins while the page is
 * open still lands in the window. A snapshot, such as an export, sends both.
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
  return {
    ...input,
    startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
  };
}

/** The window alone: the scenario filter lists what the window holds. */
const windowSchema = z.object({
  projectId: z.string(),
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
});

export const resultAtomsRouter = createTRPCRouter({
  /**
   * The scenarios that ran from code inside the window, for the scenario
   * filter. They have no row in Postgres, so the stored scenario list cannot
   * name them.
   */
  getCodeScenarios: protectedProcedure
    .input(windowSchema)
    .permission("scenarios:view")
    .query(async ({ input }) => {
      return getApp().simulations.results.getCodeScenarios({
        projectId: input.projectId,
        startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
        endDate: input.endDate,
      });
    }),

  /**
   * The targets the window names that the agent and prompt lists cannot, for
   * the target filter: those a run from code named, and the parameter
   * variants of stored targets. Neither has a row of its own in Postgres.
   */
  getRunTargets: protectedProcedure
    .input(windowSchema)
    .permission("scenarios:view")
    .query(async ({ input }) => {
      return getApp().simulations.results.getRunTargets({
        projectId: input.projectId,
        startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
        endDate: input.endDate,
      });
    }),

  /**
   * The stat strip and the group rows for one grouping, aggregated in the
   * database.
   *
   * Server-side because an atom is one scenario run: a suite of 50 scenarios
   * against 2 targets running on every merge makes roughly 60,000 atoms in 30
   * days, which is about 27 MB of JSON and not something a browser should add
   * up. Every number here moves when the filter moves, because the filter is
   * part of the query rather than applied after it.
   */
  getResultsOverview: protectedProcedure
    .input(
      resultsFilterSchema.extend({
        groupBy: z.enum(["plan", "scenario", "target", "none"]),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ input }) => {
      const { groupBy, ...filter } = input;
      return getApp().simulations.results.getOverview({
        filter: toFilter(filter),
        groupBy,
      });
    }),

  /**
   * One page of atoms, newest first.
   *
   * This is the drill-down: opening one group, or the flat list once a filter
   * has already narrowed the question. It is NOT the source the page totals
   * come from, and a caller that adds up a page is adding up whatever fitted
   * rather than what is in scope. Read `hasMore` and say so.
   */
  getResultAtoms: protectedProcedure
    .input(
      resultsFilterSchema.extend({
        limit: z.number().int().min(1).max(MAX_ATOM_PAGE).default(100),
        cursor: z.string().optional(),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ input }) => {
      const { limit, cursor, ...filter } = input;
      return getApp().simulations.results.getAtoms({
        filter: toFilter(filter),
        limit,
        cursor,
      });
    }),
});
