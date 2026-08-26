/**
 * Router for cancelling scenario jobs and batch runs.
 *
 * Dispatches cancel_requested events via the event-sourcing pipeline.
 * The simulationRunExecution process manager publishes the cancellation to
 * all worker pods, and the worker owning the scenario kills its child
 * process. Queued jobs are finished CANCELLED by the process manager itself.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { projectSchema } from "./schemas";

const logger = createLogger("langwatch:api:scenarios:cancellation");

const cancelJobSchema = projectSchema.extend({
  scenarioSetId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
});

const cancelBatchRunSchema = projectSchema.extend({
  scenarioSetId: z.string(),
  batchRunId: z.string(),
});

export const cancellationRouter = createTRPCRouter({
  cancelJob: protectedProcedure
    .input(cancelJobSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        {
          projectId: input.projectId,
          scenarioRunId: input.scenarioRunId,
          batchRunId: input.batchRunId,
        },
        "Cancel job request received",
      );

      return ctx.app.scenarios.cancelJob(input);
    }),

  cancelBatchRun: protectedProcedure
    .input(cancelBatchRunSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        {
          projectId: input.projectId,
          scenarioSetId: input.scenarioSetId,
          batchRunId: input.batchRunId,
        },
        "Cancel batch run request received",
      );

      return ctx.app.scenarios.cancelBatchRun(input);
    }),
});
