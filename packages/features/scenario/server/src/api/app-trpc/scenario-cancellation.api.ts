/**
 * Cancelling scenario jobs and batch runs over the process's tRPC transport.
 *
 * Dispatches cancel_requested events via the event-sourcing pipeline. The
 * simulationRunExecution process manager publishes the cancellation to all
 * worker pods, and the worker owning the scenario kills its child process.
 * Queued jobs are finished CANCELLED by the process manager itself.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { createLogger } from "@langwatch/observability";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { projectSchema } from "./scenario.schemas";
import type { ScenarioTrpcContext, ScenarioTrpcProcedures } from "./scenario.trpc-context";

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

export function createScenarioCancellationRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: ScenarioTrpcProcedures<TContext, TOptions, TRoot>,
) {
  const { protected: procedure, policy } = procedures;

  return trpc.router({
    cancelJob: policy("scenarios:manage")(procedure.input(cancelJobSchema)).mutation(
      async ({ ctx, input }) => {
        logger.info(
          {
            projectId: input.projectId,
            scenarioRunId: input.scenarioRunId,
            batchRunId: input.batchRunId,
          },
          "Cancel job request received",
        );

        return ctx.app.scenarios.cancelJob(input);
      },
    ),

    cancelBatchRun: policy("scenarios:manage")(procedure.input(cancelBatchRunSchema)).mutation(
      async ({ ctx, input }) => {
        logger.info(
          {
            projectId: input.projectId,
            scenarioSetId: input.scenarioSetId,
            batchRunId: input.batchRunId,
          },
          "Cancel batch run request received",
        );

        return ctx.app.scenarios.cancelBatchRun(input);
      },
    ),
  });
}
