/**
 * Router for cancelling scenario jobs and batch runs.
 *
 * Dispatches cancel_requested events via the event-sourcing pipeline.
 * The pipeline reactor broadcasts to all worker pods, and the worker
 * owning the scenario kills its child process.
 *
 * For queued jobs (not yet picked up), also dispatches finished(CANCELLED)
 * so they never execute.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { CancellationServiceDeps } from "~/server/scenarios/cancellation";
import { ScenarioCancellationService } from "~/server/scenarios/cancellation";
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

let _service: ScenarioCancellationService | null = null;
function getService(): ScenarioCancellationService {
  if (!_service) {
    _service = new ScenarioCancellationService({
      getRunsForBatch: createGetRunsForBatch(),
      dispatchCancelRequested: async ({ tenantId, scenarioRunId, occurredAt }) => {
        await getApp().simulations.cancelRun({
          tenantId,
          scenarioRunId,
          occurredAt,
        });
      },
      dispatchFinishRun: async ({ tenantId, scenarioRunId, status, occurredAt }) => {
        await getApp().simulations.finishRun({
          tenantId,
          scenarioRunId,
          status,
          occurredAt,
        });
      },
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
