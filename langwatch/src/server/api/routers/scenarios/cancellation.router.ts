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
import { scenarioQueue } from "~/server/scenarios/scenario.queue";
import { connection } from "~/server/redis";
import { SimulationFacade } from "~/server/simulations/simulation.facade";
import { getApp } from "~/server/app-layer/app";
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

async function getQueuedJobs(params: { setId: string; projectId: string }) {
  const jobs = await scenarioQueue.getJobs(["waiting", "active", "delayed"]);
  return jobs
    .filter((job) => {
      const data = job.data as Record<string, unknown> | undefined;
      return data && data.projectId === params.projectId;
    })
    .map((job) => {
      const data = job.data as Record<string, unknown> | undefined;
      return {
        scenarioRunId: (data?.scenarioRunId as string) ?? job.id ?? "",
        scenarioId: (data?.scenarioId as string) ?? "",
        batchRunId: (data?.batchRunId as string) ?? "",
        status: "waiting" as const,
      };
    });
}

function createPublishCancellation() {
  const publisher = connection;
  return publisher
    ? (message: Parameters<typeof publishCancellation>[0]["message"]) =>
        publishCancellation({ publisher, message })
    : () => Promise.resolve();
}

function createService() {
  const facade = SimulationFacade.create();
  return new ScenarioCancellationService({
    queue: scenarioQueue,
    publishCancellation: createPublishCancellation(),
    getQueuedJobs,
    saveScenarioEvent: (event) => facade.saveScenarioEvent(event),
  });
}

async function broadcastCancellation(
  projectId: string,
  scenarioRunId?: string,
  batchRunId?: string,
) {
  try {
    const payload = JSON.stringify({
      event: "simulation_updated",
      scenarioRunId,
      batchRunId,
    });
    await getApp().broadcast.broadcastToTenant(projectId, payload, "simulation_updated");
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to broadcast cancellation event");
  }
}

export const cancellationRouter = createTRPCRouter({
  cancelJob: protectedProcedure
    .input(cancelJobSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input }) => {
      logger.info(
        { projectId: input.projectId, jobId: input.jobId, batchRunId: input.batchRunId },
        "Cancel job request received",
      );

      const result = await createService().cancelJob(input);

      if (result.cancelled) {
        await broadcastCancellation(input.projectId, input.scenarioRunId, input.batchRunId);
      }

      return result;
    }),

  cancelBatchRun: protectedProcedure
    .input(cancelBatchRunSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input }) => {
      logger.info(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, batchRunId: input.batchRunId },
        "Cancel batch run request received",
      );

      const result = await createService().cancelBatchRun(input);

      if (result.cancelledCount > 0) {
        await broadcastCancellation(input.projectId, undefined, input.batchRunId);
      }

      return result;
    }),
});
