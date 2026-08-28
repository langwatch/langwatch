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
import { ScenarioReservedSetIdError } from "~/server/scenarios/errors";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "~/server/scenarios/execution/data-prefetcher";
import {
  getOnPlatformSetId,
  isInternalSetId,
} from "~/server/scenarios/internal-set-id";
import {
  type RunParameterValues,
  runParameterValuesSchema,
} from "~/server/scenarios/parameters";
import { resolveRunParameters } from "~/server/scenarios/resolve-run-parameters";
import { type RunActor, withActor } from "~/server/scenarios/run-actor";
import {
  type ResolvedRunModels,
  withResolvedModels,
} from "~/server/scenarios/run-models";
import { runNoteSchema, withNote } from "~/server/scenarios/run-note";
import {
  encryptRunSecretValues,
  type RunSecretCiphertext,
} from "~/server/scenarios/run-secret-values";
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
  /**
   * Where the run is recorded. Defaults to this project's one-off bucket.
   *
   * A caller may name an EXTERNAL set, the address its own code pushes
   * scenario events under. It may not name an internal one: see
   * {@link assertWritableSetId}.
   */
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
 * Refuses a set address this run may not be written to.
 *
 * The internal namespace is the platform's own. `__internal__<suiteId>__suite`
 * is a run plan's address, and every read of the Results tab aggregates the
 * runs stored there, so a one-off run written into it silently changes that
 * plan's pass rate, cost and trend. `__internal__<projectId>__on-platform-
 * scenarios` is the one-off bucket, and only this project's own.
 *
 * Anything outside the namespace is an external set, a name the customer's own
 * code chooses, and stays free.
 *
 * Tenancy is enforced elsewhere; this is about not corrupting a plan the caller
 * is entitled to read.
 *
 * @see specs/scenarios/reserved-set-write-guard.feature
 */
export function assertWritableSetId(params: {
  setId: string;
  projectId: string;
}): void {
  if (!isInternalSetId(params.setId)) return;
  if (params.setId === getOnPlatformSetId(params.projectId)) return;
  throw new ScenarioReservedSetIdError();
}

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
  prisma,
  projectId,
  scenarioId,
  values,
}: {
  prisma: PrismaClient;
  projectId: string;
  scenarioId: string;
  values?: RunParameterValues;
}): Promise<{
  parameters: RunParameterValues;
  secretParameters: RunSecretCiphertext;
  /**
   * The scenario's version at this read, stamped onto the queued run so it
   * says which state of the scenario it ran. Undefined only when the read
   * found no scenario, in which case the prefetch refuses the run anyway.
   */
  scenarioVersion: number | undefined;
}> {
  const scenarios = await ScenarioService.create(prisma).getRunConfigByIds({
    ids: [scenarioId],
    projectId,
  });
  const resolved = await resolveRunParameters({ scenarios, values });
  const forScenario = resolved.get(scenarioId);
  return {
    parameters: forScenario?.parameters ?? {},
    // Encrypted here, before the validation prefetch and before the queued
    // command: neither is allowed to hold a readable credential.
    secretParameters: encryptRunSecretValues(
      forScenario?.secretParameters ?? {},
    ),
    scenarioVersion: scenarios.find((scenario) => scenario.id === scenarioId)
      ?.version,
  };
}

/**
 * Dispatches the queued command, which is what writes QUEUED state to
 * ClickHouse before the execution job is scheduled, the same order
 * SuiteRunService.startRun uses. The resolved parameters travel on the
 * metadata, which is the only channel that carries them into execution.
 *
 * The secret values travel beside the metadata rather than inside it, so the
 * fold projection cannot copy them into the runs store. Only their names go on
 * the metadata.
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
  secretParameters,
  note,
  scenarioVersion,
  actor,
  resolvedModels,
}: {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  name: string;
  target: z.infer<typeof simulationTargetSchema>;
  parameters: RunParameterValues;
  secretParameters: RunSecretCiphertext;
  note: string | undefined;
  scenarioVersion: number | undefined;
  /** The person who started the run, or nothing when none is named. */
  actor: RunActor | undefined;
  /**
   * The models the validation prefetch resolved for this run, recorded so the
   * run says which simulator played the person and which judge decided the
   * verdict, whatever the project default becomes later.
   */
  resolvedModels: ResolvedRunModels;
}): Promise<void> {
  const secretParameterNames = Object.keys(secretParameters);
  const metadata = {
    // The reserved namespace records the target this run was pointed at, the
    // scenario version it was queued from, who started it and the models it
    // resolved, the same way a suite run does.
    langwatch: {
      targetReferenceId: target.referenceId,
      targetType: target.type,
      ...(scenarioVersion !== undefined ? { scenarioVersion } : {}),
      ...withActor(actor),
      ...withResolvedModels(resolvedModels),
    },
    ...withNote(note),
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    ...(secretParameterNames.length > 0 ? { secretParameterNames } : {}),
  };
  try {
    await getApp().simulations.queueRun({
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
      assertWritableSetId({ setId, projectId: input.projectId });
      const batchRunId = input.batchRunId ?? generateBatchRunId();

      const { parameters, secretParameters, scenarioVersion } =
        await resolveParametersForRun({
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
          secretParameters,
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
        secretParameters,
        note: input.note,
        scenarioVersion,
        actor: { id: ctx.session.user.id, label: "user" },
        resolvedModels: prefetchResult.resolvedModels,
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
