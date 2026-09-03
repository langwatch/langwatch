/**
 * Launching a scenario run.
 *
 * The orchestration that turns "run this scenario against this target" into a
 * queued run: resolve the connected target, resolve the run's parameters and
 * secrets, validate everything a job needs before a job exists, and dispatch
 * the queued command. It ends by returning the platform-generated
 * `scenarioRunId`, the same handle the tRPC `run` mutation returns.
 *
 * Extracted from `simulation-runner.router.ts` so the tRPC router and the
 * scenario canary health probe share one launch path rather than each keeping
 * its own copy. The only thing that varies between callers is the actor, which
 * is passed in.
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { resolveConnectedTarget } from "~/server/scenarios/connected-target.service";
import { ScenarioReservedSetIdError } from "~/server/scenarios/errors";
import {
  createDataPrefetcherDependencies,
  type PrefetchResult,
  prefetchScenarioData,
} from "~/server/scenarios/execution/data-prefetcher";
import {
  getOnPlatformSetId,
  isInternalSetId,
} from "~/server/scenarios/internal-set-id";
import {
  type RunParameterValues,
  type ScenarioParameterDefinition,
} from "~/server/scenarios/parameters";
import { resolveRunParameters } from "~/server/scenarios/resolve-run-parameters";
import { type RunActor, withActor } from "~/server/scenarios/run-actor";
import {
  type ResolvedRunModels,
  withResolvedModels,
} from "~/server/scenarios/run-models";
import { withNote } from "~/server/scenarios/run-note";
import {
  encryptRunSecretValues,
  type RunSecretCiphertext,
} from "~/server/scenarios/run-secret-values";
import { generateBatchRunId } from "~/server/scenarios/scenario.ids";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import type { SimulationTarget } from "~/server/scenarios/simulation-target";
import { KSUID_RESOURCES } from "~/utils/constants";

const logger = createLogger("LaunchScenarioRun");

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
 * `secrets.NAME`: the scenario's declared defaults and the target agent's
 * own, with the supplied values over the top, and the secret values split
 * out and encrypted.
 *
 * Runs before anything is queued, the same way a suite run does, so an unknown
 * name, a secret with no value, a reference with no value, or unrenderable text
 * refuses the request rather than producing a run that fails halfway through.
 */
async function resolveParametersForRun({
  prisma,
  projectId,
  scenarioId,
  targetDefinitions,
  values,
}: {
  prisma: PrismaClient;
  projectId: string;
  scenarioId: string;
  targetDefinitions: ScenarioParameterDefinition[];
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
  const resolved = await resolveRunParameters({
    scenarios,
    targetDefinitions,
    values,
  });
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
  target: SimulationTarget;
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
  resolvedModels: ResolvedRunModels | null;
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
 * Reads back everything the run needs, so a configuration error refuses the
 * run before a job exists.
 *
 * @throws {TRPCError} BAD_REQUEST when the run cannot be prepared
 */
async function validateRunData({
  projectId,
  scenarioId,
  setId,
  batchRunId,
  parameters,
  secretParameters,
  target,
}: {
  projectId: string;
  scenarioId: string;
  setId: string;
  batchRunId: string;
  parameters: RunParameterValues;
  secretParameters: RunSecretCiphertext;
  target: SimulationTarget;
}): Promise<Extract<PrefetchResult, { success: true }>> {
  const prefetchResult = await prefetchScenarioData({
    context: {
      projectId,
      scenarioId,
      setId,
      batchRunId,
      parameters,
      secretParameters,
    },
    target,
    deps: createDataPrefetcherDependencies(),
  });

  if (!prefetchResult.success) {
    logger.warn(
      { projectId, scenarioId, error: prefetchResult.error },
      "Scenario validation failed",
    );
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: prefetchResult.error,
    });
  }

  return prefetchResult;
}

/** The handle a launched run is tracked by, plus the bucket it went to. */
export interface LaunchedScenarioRun {
  scheduled: true;
  setId: string;
  batchRunId: string;
  scenarioRunId: string;
}

/**
 * Queues one scenario run against one target and returns its handle.
 *
 * Schedules the scenario for async execution and returns immediately with the
 * generated `scenarioRunId` for tracking; it does NOT report success/failure of
 * the run's execution — that settles asynchronously. Every configuration error
 * refuses the request before a job exists, the same way a suite run does.
 *
 * @throws {ScenarioReservedSetIdError} when `setId` names a set the platform
 *   reserves.
 * @throws {TRPCError} BAD_REQUEST when the run cannot be prepared, or
 *   INTERNAL_SERVER_ERROR when the queue command itself fails.
 */
export async function launchScenarioRun({
  prisma,
  projectId,
  scenarioId,
  target: requestedTarget,
  actor,
  setId: requestedSetId,
  batchRunId: requestedBatchRunId,
  parameters: parameterValues,
  note,
}: {
  prisma: PrismaClient;
  projectId: string;
  scenarioId: string;
  target: SimulationTarget;
  /** The person the run is recorded against, and how they reached it. */
  actor: RunActor;
  setId?: string;
  /** Optional client-generated batch run ID for immediate placeholder feedback. */
  batchRunId?: string;
  parameters?: RunParameterValues;
  /** One short line describing why this run was started. */
  note?: string;
}): Promise<LaunchedScenarioRun> {
  const setId = requestedSetId ?? getOnPlatformSetId(projectId);
  assertWritableSetId({ setId, projectId });
  const batchRunId = requestedBatchRunId ?? generateBatchRunId();

  const { target, targetDefinitions } = await resolveConnectedTarget({
    prisma,
    projectId,
    target: requestedTarget,
    actor,
  });
  const { parameters, secretParameters, scenarioVersion } =
    await resolveParametersForRun({
      prisma,
      projectId,
      scenarioId,
      targetDefinitions,
      values: parameterValues,
    });

  const prefetchResult = await validateRunData({
    projectId,
    scenarioId,
    setId,
    batchRunId,
    parameters,
    secretParameters,
    target,
  });

  const scenarioRunId = generate(KSUID_RESOURCES.SCENARIO_RUN).toString();

  logger.info(
    { projectId, scenarioId, batchRunId, scenarioRunId },
    "Scheduling scenario execution",
  );

  await queueRun({
    projectId,
    scenarioId,
    scenarioRunId,
    batchRunId,
    setId,
    name: prefetchResult.data.scenario.name,
    target,
    parameters,
    secretParameters,
    note,
    scenarioVersion,
    actor,
    resolvedModels: prefetchResult.resolvedModels,
  });

  // No explicit job scheduling — the execution subscriber picks up the queued
  // event via the GroupQueue and spawns the child process.
  logger.info({ batchRunId, scenarioRunId }, "Scenario queued via event-sourcing");

  return { scheduled: true, setId, batchRunId, scenarioRunId };
}
