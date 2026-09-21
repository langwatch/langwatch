import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { MAX_RUN_CONFIGURATIONS } from "~/server/app-layer/simulations/run-configurations/run-configurations.clickhouse.repository";

export const runConfigurationsRouter = createTRPCRouter({
  /**
   * Every configuration this project's run plans already ran with, newest
   * first, one entry per configuration.
   *
   * The Run name dropdown reads this and filters it by the scope the dialog
   * currently holds. It replaces the plan-row read, which could only ever
   * answer one entry per plan: a plan row holds the configuration of its LAST
   * run, while two runs of one plan that used different parameters or a
   * different repeat count are two configurations and both belong in the list.
   *
   * `startDate` widens the window past the default. An empty list is the
   * ordinary state of a project whose plans never ran.
   */
  getRunConfigurations: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.number().int().nonnegative().optional(),
        endDate: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(MAX_RUN_CONFIGURATIONS).optional(),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ input }) => {
      return getApp().simulations.runConfigurations.getEntries(input);
    }),
});
