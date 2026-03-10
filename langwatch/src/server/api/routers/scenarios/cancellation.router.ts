/**
 * Router for cancelling scenario jobs and batch runs.
 *
 * Provides two mutations:
 * - cancelJob: Cancel a single scenario job
 * - cancelBatchRun: Cancel all remaining jobs in a batch run
 *
 * Both require `scenarios:manage` permission (same as running scenarios).
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ScenarioCancellationService } from "~/server/scenarios/cancellation";
import { publishCancellation } from "~/server/scenarios/cancellation-channel";
import { scenarioQueue } from "~/server/scenarios/scenario.queue";
import { connection } from "~/server/redis";
import { SimulationService } from "~/server/simulations/simulation.service";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../../rbac";
import { projectSchema } from "./schemas";

const logger = createLogger("langwatch:api:scenarios:cancellation");

const cancelJobSchema = projectSchema.extend({
  jobId: z.string(),
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
  /**
   * Cancel a single scenario job.
   *
   * Removes the job from the queue (if queued) or marks it as failed (if active),
   * then persists a cancellation event. Idempotent for already-terminal jobs.
   */
  cancelJob: protectedProcedure
    .input(cancelJobSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input, ctx }) => {
      logger.info(
        { projectId: input.projectId, jobId: input.jobId, batchRunId: input.batchRunId },
        "Cancel job request received",
      );

      const publisher = connection;
      const service = new ScenarioCancellationService({
        queue: scenarioQueue,
        simulationService: SimulationService.create(ctx.prisma),
        publishCancellation: publisher
          ? (message) => publishCancellation({ publisher, message })
          : () => Promise.resolve(),
      });

      return service.cancelJob(input);
    }),

  /**
   * Cancel all remaining (non-terminal) jobs in a batch run.
   *
   * Fetches current run data, filters to cancellable runs, and cancels each
   * in parallel chunks. Completed/failed/cancelled jobs are left untouched.
   */
  cancelBatchRun: protectedProcedure
    .input(cancelBatchRunSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input, ctx }) => {
      logger.info(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, batchRunId: input.batchRunId },
        "Cancel batch run request received",
      );

      const publisher = connection;
      const service = new ScenarioCancellationService({
        queue: scenarioQueue,
        simulationService: SimulationService.create(ctx.prisma),
        publishCancellation: publisher
          ? (message) => publishCancellation({ publisher, message })
          : () => Promise.resolve(),
      });

      return service.cancelBatchRun(input);
    }),
});
