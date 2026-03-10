/**
 * Router for cancelling scenario jobs and batch runs.
 *
 * Active jobs: cancel signal via Redis pub/sub → worker handles via AbortSignal.
 * Queued jobs: removed from BullMQ + cancellation event written to ES
 * (since no worker will ever process them).
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ScenarioCancellationService } from "~/server/scenarios/cancellation";
import { publishCancellation } from "~/server/scenarios/cancellation-channel";
import { ScenarioJobRepository } from "~/server/scenarios/scenario-job.repository";
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

function createGetQueuedJobs() {
  const jobRepo = new ScenarioJobRepository(scenarioQueue);
  return (params: { setId: string; projectId: string }) =>
    jobRepo.getQueuedAndActiveJobs(params).then((runs) =>
      runs.map((r) => ({
        scenarioRunId: r.scenarioRunId,
        scenarioId: r.scenarioId,
        batchRunId: r.batchRunId,
        status: r.status,
      })),
    );
}

function createPublishCancellation() {
  const publisher = connection;
  return publisher
    ? (message: Parameters<typeof publishCancellation>[0]["message"]) =>
        publishCancellation({ publisher, message })
    : () => Promise.resolve();
}

export const cancellationRouter = createTRPCRouter({
  cancelJob: protectedProcedure
    .input(cancelJobSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input, ctx }) => {
      logger.info(
        { projectId: input.projectId, jobId: input.jobId, batchRunId: input.batchRunId },
        "Cancel job request received",
      );

      const simulationService = SimulationService.create(ctx.prisma);
      const service = new ScenarioCancellationService({
        queue: scenarioQueue,
        publishCancellation: createPublishCancellation(),
        getQueuedJobs: createGetQueuedJobs(),
        saveScenarioEvent: (event) => simulationService.saveScenarioEvent(event),
      });

      return service.cancelJob(input);
    }),

  cancelBatchRun: protectedProcedure
    .input(cancelBatchRunSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input, ctx }) => {
      logger.info(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, batchRunId: input.batchRunId },
        "Cancel batch run request received",
      );

      const simulationService = SimulationService.create(ctx.prisma);
      const service = new ScenarioCancellationService({
        queue: scenarioQueue,
        publishCancellation: createPublishCancellation(),
        getQueuedJobs: createGetQueuedJobs(),
        saveScenarioEvent: (event) => simulationService.saveScenarioEvent(event),
      });

      return service.cancelBatchRun(input);
    }),
});
