/**
 * Router for running scenarios against targets.
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "~/server/scenarios/execution/data-prefetcher";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import {
  type RunParameterValues,
  runParameterValuesSchema,
} from "~/server/scenarios/parameters";
import { resolveRunParameters } from "~/server/scenarios/resolve-run-parameters";
import { generateBatchRunId } from "~/server/scenarios/scenario.ids";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import { KSUID_RESOURCES } from "~/utils/constants";
import { projectSchema } from "./schemas";

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
});

/**
 * Resolves what the run reads as `params.NAME`: the scenario's declared
 * defaults, with the supplied values over the top.
 *
 * Runs before anything is queued, the same way a suite run does, so an unknown
 * name, a reference with no value, or unrenderable text refuses the request
 * rather than producing a run that fails halfway through.
 */
async function resolveParametersForRun({
  prisma,
  projectId,
  scenarioId,
  values,
}: {
  prisma: PrismaClient;
  projectId: string;
  scenarioId: string;
  values?: RunParameterValues;
}): Promise<RunParameterValues> {
  const scenarios = await ScenarioService.create(prisma).getRunConfigByIds({
    ids: [scenarioId],
    projectId,
  });
  const resolved = await resolveRunParameters({ scenarios, values });
  return resolved.get(scenarioId) ?? {};
}

/**
 * Dispatches the queued command, which is what writes QUEUED state to
 * ClickHouse before the execution job is scheduled, the same order
 * SuiteRunService.startRun uses. The resolved parameters travel on the
 * metadata, which is the only channel that carries them into execution.
 */
async function queueRun({
  projectId,
  scenarioId,
  scenarioRunId,
  batchRunId,
  setId,
  name,
  target,
  parameters,
}: {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  name: string;
  target: z.infer<typeof simulationTargetSchema>;
  parameters: RunParameterValues;
}): Promise<void> {
  try {
    await getApp().simulations.queueRun({
      tenantId: projectId,
      scenarioRunId,
      scenarioId,
      batchRunId,
      scenarioSetId: setId,
      name,
      ...(Object.keys(parameters).length > 0
        ? { metadata: { parameters } }
        : {}),
      target: { type: target.type, referenceId: target.referenceId },
      occurredAt: Date.now(),
    });
  } catch (error) {
    logger.error(
      { error, projectId, scenarioRunId, batchRunId },
      "Failed to queue scenario run",
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to queue scenario run",
      cause: error,
    });
  }
}

/**
 * Simulation runner - executing scenarios against targets.
 */
export const simulationRunnerRouter = createTRPCRouter({
  /**
   * Run a scenario against a target.
   *
   * Schedules the scenario for async execution and returns immediately
   * with the batch run ID for tracking. Does NOT return success/failure
   * of scenario execution - that happens asynchronously.
   */
  run: protectedProcedure
    .input(runScenarioSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const setId = input.setId ?? getOnPlatformSetId(input.projectId);
      const batchRunId = input.batchRunId ?? generateBatchRunId();

      const parameters = await resolveParametersForRun({
        prisma: ctx.prisma,
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        values: input.parameters,
      });

      // Validate early - prefetch data to catch configuration errors before scheduling
      const deps = createDataPrefetcherDependencies();
      const prefetchResult = await prefetchScenarioData({
        context: {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          setId,
          batchRunId,
          parameters,
        },
        target: input.target,
        deps,
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

      const scenarioRunId = generate(KSUID_RESOURCES.SCENARIO_RUN).toString();

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
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        scenarioRunId,
        batchRunId,
        setId,
        name: prefetchResult.data.scenario.name,
        target: input.target,
        parameters,
      });

      // No explicit job scheduling — the execution subscriber picks up the queued
      // event via the GroupQueue and spawns the child process.
      logger.info(
        { batchRunId, scenarioRunId },
        "Scenario queued via event-sourcing",
      );

      return {
        scheduled: true,
        setId,
        batchRunId,
        scenarioRunId,
      };
    }),
});
