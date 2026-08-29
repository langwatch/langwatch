/**
 * Running scenarios against targets, over the process's tRPC transport.
 */
import { createLogger } from "@langwatch/observability";
import {
  generateBatchRunId,
  generateScenarioRunId,
  getOnPlatformSetId,
  runNoteSchema,
  runParameterValuesSchema,
  ScenarioNotFoundError,
  type RunParameterValues,
} from "@langwatch/scenario-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { ScenarioApp } from "#app/scenario.app";
import { projectSchema } from "./scenario.schemas";
import type { ScenarioTrpcContext, ScenarioTrpcProcedures } from "./scenario.trpc-context";

const logger = createLogger("SimulationRunnerRouter");

/**
 * Target for scenario simulation.
 * Extensible: add new types as needed (llm, workflow, etc.)
 */
export const simulationTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});

export type SimulationTarget = z.infer<typeof simulationTargetSchema>;

const runScenarioSchema = projectSchema.extend({
  scenarioId: z.string(),
  target: simulationTargetSchema,
  /** Optional set ID - defaults to internal on-platform set ID for ad-hoc runs */
  setId: z.string().optional(),
  /** Optional client-generated batch run ID for immediate placeholder feedback */
  batchRunId: z.string().optional(),
  /**
   * Constant values for the run. A value supplied here overrides the
   * scenario's own default for that name.
   */
  parameters: runParameterValuesSchema.optional(),
  /** One short line describing why this run was started. */
  note: runNoteSchema,
});

/**
 * Resolves what the run reads as `params.NAME` and what it reads as
 * `secrets.NAME`: the scenario's declared defaults, with the supplied values
 * over the top, and the secret values split out and encrypted.
 *
 * Runs before anything is queued, the same way a suite run does, so an unknown
 * name, a secret with no value, a reference with no value, or unrenderable text
 * refuses the request rather than producing a run that fails halfway through.
 */
async function resolveParametersForRun({
  app,
  projectId,
  scenarioId,
  values,
}: {
  app: ScenarioApp;
  projectId: string;
  scenarioId: string;
  values?: RunParameterValues;
}) {
  try {
    return await app.resolveRunParameters({ projectId, scenarioId, values });
  } catch (error) {
    if (error instanceof ScenarioNotFoundError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

/**
 * Queues one run, and turns a failure to queue it into the transport's own
 * refusal.
 *
 * The envelope itself — what a queued run's metadata carries, and the rule
 * that the secret VALUES travel beside it rather than inside it — belongs to
 * {@link ScenarioApp.queueSimulationRun}. What is left here is the wrapping:
 * the log line and the tRPC error code a caller sees.
 */
async function queueRun(
  app: ScenarioApp,
  input: Parameters<ScenarioApp["queueSimulationRun"]>[0],
): Promise<void> {
  try {
    await app.queueSimulationRun(input);
  } catch (error) {
    logger.error(
      {
        error,
        projectId: input.projectId,
        scenarioRunId: input.scenarioRunId,
        batchRunId: input.batchRunId,
      },
      "Failed to queue scenario run",
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to queue scenario run",
      cause: error,
    });
  }
}

export function createSimulationRunnerRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: ScenarioTrpcProcedures<TContext, TOptions, TRoot>,
) {
  const { protected: procedure, policy } = procedures;

  return trpc.router({
    /**
     * Run a scenario against a target.
     *
     * Schedules the scenario for async execution and returns immediately
     * with the batch run ID for tracking. Does NOT return success/failure
     * of scenario execution - that happens asynchronously.
     */
    run: policy("scenarios:manage")(procedure.input(runScenarioSchema)).mutation(
      async ({ ctx, input }) => {
        const setId = input.setId ?? getOnPlatformSetId(input.projectId);
        const batchRunId = input.batchRunId ?? generateBatchRunId();

        const { parameters, secretParameters, scenarioVersion } = await resolveParametersForRun({
          app: ctx.app.scenarios,
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          values: input.parameters,
        });

        const prefetchResult = await ctx.app.scenarios.prefetchExecution({
          context: {
            projectId: input.projectId,
            scenarioId: input.scenarioId,
            setId,
            batchRunId,
            parameters,
            secretParameters,
          },
          target: input.target,
        });

        if (!prefetchResult.success) {
          logger.warn(
            {
              projectId: input.projectId,
              scenarioId: input.scenarioId,
              error: prefetchResult.error,
            },
            "Scenario validation failed",
          );
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: prefetchResult.error,
          });
        }

        const scenarioRunId = generateScenarioRunId();

        logger.info(
          {
            projectId: input.projectId,
            scenarioId: input.scenarioId,
            batchRunId,
            scenarioRunId,
          },
          "Scheduling scenario execution",
        );

        await queueRun(ctx.app.scenarios, {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          scenarioRunId,
          batchRunId,
          setId,
          name: prefetchResult.data.scenario.name,
          target: input.target,
          parameters,
          secretParameters,
          note: input.note,
          scenarioVersion,
        });

        // No explicit job scheduling — the execution subscriber picks up the queued
        // event via the GroupQueue and spawns the child process.
        logger.info({ batchRunId, scenarioRunId }, "Scenario queued via event-sourcing");

        return {
          scheduled: true,
          setId,
          batchRunId,
          scenarioRunId,
        };
      },
    ),
  });
}
