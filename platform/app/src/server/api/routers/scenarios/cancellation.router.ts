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
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { App } from "~/server/app-layer/app";
import type { CancellationServiceDeps } from "~/server/scenarios/cancellation";
import { ScenarioCancellationService } from "~/server/scenarios/cancellation";
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

function createGetRunsForBatch(
  app: Pick<App, "simulations">,
): CancellationServiceDeps["getRunsForBatch"] {
  const simulationRuns = app.simulations.runs;

  return async (params) => {
    const result = await simulationRuns.getRunDataForBatchRun(params);
    return result.changed ? result.runs : [];
  };
}

const services = new WeakMap<App, ScenarioCancellationService>();

function serviceFor(app: App): ScenarioCancellationService {
  const cached = services.get(app);
  if (cached) return cached;
  const service = new ScenarioCancellationService({
      getRunsForBatch: createGetRunsForBatch(app),
      dispatchCancelRequested: async ({
        tenantId,
        scenarioRunId,
        occurredAt,
      }) => {
        await app.simulations.cancelRun({
          tenantId,
          scenarioRunId,
          occurredAt,
        });
      },
    });
  services.set(app, service);
  return service;
}

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

      return serviceFor(ctx.app).cancelJob(input);
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

      return serviceFor(ctx.app).cancelBatchRun(input);
    }),
});
