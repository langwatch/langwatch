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
import { createTrpcService } from "@langwatch/api/trpc";
import { createLogger } from "@langwatch/observability";
import {
  scenarioCancelBatchRunResultSchema,
  scenarioCancelJobResultSchema,
} from "@langwatch/scenario-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { projectSchema } from "../../rules/scenario-schemas.rules";
import type {
  ScenarioTrpcContext,
  ScenarioTrpcProcedures,
} from "../../rules/scenario-trpc-context.rules";

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
  const { protected: procedure, policy, validateOutput } = procedures;

  return createTrpcService({
    root: trpc,
    procedures: { protected: procedure, policy },
    validateOutput,
  })
    .mutation("cancelJob", (p) =>
      p
        .withInput(cancelJobSchema)
        .withOutput(scenarioCancelJobResultSchema)
        .withPermission("scenarios:manage")
        .handle(async ({ ctx, input }) => {
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
    )
    .mutation("cancelBatchRun", (p) =>
      p
        .withInput(cancelBatchRunSchema)
        .withOutput(scenarioCancelBatchRunResultSchema)
        .withPermission("scenarios:manage")
        .handle(async ({ ctx, input }) => {
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
    )
    .build();
}
