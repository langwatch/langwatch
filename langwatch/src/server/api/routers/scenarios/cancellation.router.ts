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
import type { Job } from "bullmq";
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
  scenarioSetId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
});

const cancelBatchRunSchema = projectSchema.extend({
  scenarioSetId: z.string(),
  batchRunId: z.string(),
});

function createGetRunsForBatch(): CancellationServiceDeps["getRunsForBatch"] {
  const facade = SimulationFacade.create();

  return async (params) => {
    const result = await facade.getRunDataForBatchRun(params);
    return result.changed ? result.runs : [];
  };
}

function createRemoveQueuedJob(): CancellationServiceDeps["removeQueuedJob"] {
  return async ({ projectId, scenarioRunId }) => {
    const jobs = await scenarioQueue.getJobs(["waiting", "delayed", "prioritized"]);
    const job = jobs.find((j) => {
      const data = j.data as Record<string, unknown> | undefined;
      return data?.scenarioRunId === scenarioRunId && data?.projectId === projectId;
    });
    if (!job) return false;
    try {
      await (job as Job).remove();
      return true;
    } catch {
      return false;
    }
  };
}

function createSignalCancel(): CancellationServiceDeps["signalCancel"] {
  const publisher = connection;
  if (!publisher) {
    return (_params) => {
      logger.warn("Redis unavailable: cannot publish cancellation signal for active jobs");
      return Promise.resolve(false);
    };
  }
  return async ({ projectId, scenarioRunId, batchRunId }) => {
    // Find the actual BullMQ job ID — worker.cancelJob() needs it, not scenarioRunId
    const activeJobs = await scenarioQueue.getJobs(["active"]);
    const job = activeJobs.find((j) => {
      const data = j.data as Record<string, unknown> | undefined;
      return data?.scenarioRunId === scenarioRunId && data?.projectId === projectId;
    });

    // Only signal if the job is actually active — otherwise the signal
    // fires into the void and prevents the force-cancel fallback.
    if (!job) return false;

    return publishCancellation({
      publisher,
      message: { jobId: job.id ?? scenarioRunId, projectId, scenarioRunId, batchRunId },
    });
  };
}

/**
 * Saves cancellation event to both ES (legacy) and ClickHouse (event-sourcing).
 *
 * The event-sourcing finishRun command triggers a reactor that broadcasts
 * an SSE event, so the UI updates without a page refresh.
 */
function createSaveScenarioEvent(): CancellationServiceDeps["saveScenarioEvent"] {
  return async (event) => {
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
      getRunsForBatch: createGetRunsForBatch(),
      removeQueuedJob: createRemoveQueuedJob(),
      signalCancel: createSignalCancel(),
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
        { projectId: input.projectId, scenarioRunId: input.scenarioRunId, batchRunId: input.batchRunId },
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
