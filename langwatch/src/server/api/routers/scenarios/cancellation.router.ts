/**
 * Router for cancelling scenario jobs and batch runs.
 *
 * Active jobs: cancel signal via Redis pub/sub → worker handles via AbortSignal.
 * Queued jobs: removed from BullMQ + cancellation event written to both ES
 * and ClickHouse (via event-sourcing finishRun command).
 *
 * The event-sourcing reactor handles SSE broadcast automatically,
 * so cancelled status appears in the UI without a page refresh.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { CancellationServiceDeps } from "~/server/scenarios/cancellation";
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
      return (
        data &&
        data.projectId === params.projectId &&
        data.setId === params.setId
      );
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

function createPublishCancellation(): CancellationServiceDeps["publishCancellation"] {
  const publisher = connection;
  if (!publisher) {
    return (_message) => {
      logger.warn("Redis unavailable: cannot publish cancellation signal for active jobs");
      return Promise.resolve(false);
    };
  }
  return (message) => publishCancellation({ publisher, message });
}

/**
 * Saves cancellation event to both ES (legacy) and ClickHouse (event-sourcing).
 *
 * The event-sourcing finishRun command triggers a reactor that broadcasts
 * an SSE event, so the UI updates without a page refresh.
 */
function createSaveScenarioEvent(): CancellationServiceDeps["saveScenarioEvent"] {
  const facade = SimulationFacade.create();

  return async (event) => {
    // Write to ES for backwards compatibility (skip when ES writes are disabled)
    const project = await getApp().projects.repo.getById(event.projectId);
    if (!project?.disableElasticSearchSimulationWriting) {
      await facade.saveScenarioEvent(event);
    }

    // Dispatch to event-sourcing so ClickHouse gets the CANCELLED status
    // and the reactor broadcasts an SSE update to connected clients.
    try {
      await getApp().simulations.finishRun({
        tenantId: event.projectId,
        scenarioRunId: event.scenarioRunId,
        status: event.status,
        results: undefined,
        occurredAt: event.timestamp,
      });
    } catch (err) {
      logger.warn(
        { err, scenarioRunId: event.scenarioRunId },
        "Failed to dispatch finishRun to event-sourcing (ES write succeeded)",
      );
    }
  };
}

let _service: ScenarioCancellationService | null = null;
function getService(): ScenarioCancellationService {
  if (!_service) {
    _service = new ScenarioCancellationService({
      queue: scenarioQueue,
      publishCancellation: createPublishCancellation(),
      getQueuedJobs,
      saveScenarioEvent: createSaveScenarioEvent(),
    });
  }
  return _service;
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

      return getService().cancelJob(input);
    }),

  cancelBatchRun: protectedProcedure
    .input(cancelBatchRunSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input }) => {
      logger.info(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, batchRunId: input.batchRunId },
        "Cancel batch run request received",
      );

      return getService().cancelBatchRun(input);
    }),
});
