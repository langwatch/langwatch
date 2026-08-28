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
  withNote,
  type RunParameterValues,
  type RunSecretCiphertext,
  type ScenarioService,
  type SimulationService,
} from "@langwatch/scenario-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
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
  scenarios,
  projectId,
  scenarioId,
  values,
}: {
  scenarios: ScenarioService;
  projectId: string;
  scenarioId: string;
  values?: RunParameterValues;
}): Promise<{
  parameters: RunParameterValues;
  secretParameters: RunSecretCiphertext;
  /** The scenario version read with the parameters and stamped onto the run. */
  scenarioVersion: number;
}> {
  try {
    return await scenarios.resolveRunParameters({ projectId, scenarioId, values });
  } catch (error) {
    if (error instanceof ScenarioNotFoundError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

/**
 * Dispatches the queued command, which is what writes QUEUED state to
 * ClickHouse before the execution job is scheduled, the same order
 * Suite execution port uses. The resolved parameters travel on the
 * metadata, which is the only channel that carries them into execution.
 *
 * The secret values travel beside the metadata rather than inside it, so the
 * fold projection cannot copy them into the runs store. Only their names go on
 * the metadata.
 */
async function queueRun({
  simulations,
  projectId,
  scenarioId,
  scenarioRunId,
  batchRunId,
  setId,
  name,
  target,
  parameters,
  secretParameters,
  note,
  scenarioVersion,
}: {
  simulations: SimulationService;
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  name: string;
  target: SimulationTarget;
  parameters: RunParameterValues;
  secretParameters: RunSecretCiphertext;
  note: string | undefined;
  scenarioVersion: number | undefined;
}): Promise<void> {
  const secretParameterNames = Object.keys(secretParameters);
  const metadata = {
    // The reserved namespace records the target this run was pointed at and
    // the scenario version it was queued from, the same way a suite run does.
    langwatch: {
      targetReferenceId: target.referenceId,
      targetType: target.type,
      ...(scenarioVersion !== undefined ? { scenarioVersion } : {}),
    },
    ...withNote(note),
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    ...(secretParameterNames.length > 0 ? { secretParameterNames } : {}),
  };
  try {
    await simulations.queueRun({
      tenantId: projectId,
      scenarioRunId,
      scenarioId,
      batchRunId,
      scenarioSetId: setId,
      name,
      metadata,
      ...(secretParameterNames.length > 0 ? { secretParameters } : {}),
      target: { type: target.type, referenceId: target.referenceId },
      occurredAt: Date.now(),
    });
  } catch (error) {
    logger.error({ error, projectId, scenarioRunId, batchRunId }, "Failed to queue scenario run");
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
          scenarios: ctx.app.scenarios,
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          values: input.parameters,
        });

        const prefetchResult = await ctx.app.scenarioExecution.prefetch({
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

        await queueRun({
          simulations: ctx.app.simulations,
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
