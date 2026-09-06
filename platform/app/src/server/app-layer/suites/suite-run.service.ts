import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { SuiteRunStateData } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import type { RunActor } from "~/server/scenarios/run-actor";
import { withActor } from "~/server/scenarios/run-actor";
import {
  type ResolvedRunModels,
  withResolvedModels,
} from "~/server/scenarios/run-models";
import type { RunModelsResolver } from "~/server/scenarios/run-models.resolver";
import { withNote } from "~/server/scenarios/run-note";
import type { RunSecretCiphertext } from "~/server/scenarios/run-secret-values";
import { generateBatchRunId } from "~/server/scenarios/scenario.ids";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { hasParameterOverrides, targetKeyOf } from "~/server/suites/target-key";
import { KSUID_RESOURCES } from "~/utils/constants";
import { traced } from "../tracing";
import { SuiteRunClickHouseRepository } from "./repositories/suite-run.clickhouse.repository";
import {
  NullSuiteRunReadRepository,
  type SuiteRunReadRepository,
} from "./repositories/suite-run.repository";

const logger = createLogger("langwatch:suite-run:service");

/** One scheduled item returned by startRun for ES dual-write. */
export type SuiteRunItem = {
  scenarioRunId: string;
  scenarioId: string;
  target: SuiteRunTarget;
  name: string | undefined;
};

/** Result of scheduling a suite run */
export type SuiteRunResult = {
  batchRunId: string;
  setId: string;
  jobCount: number;
  skippedArchived: {
    scenarios: string[];
    targets: string[];
  };
  /** Items scheduled; used by the router to dual-write RUN_STARTED events to ES. */
  items: SuiteRunItem[];
};

/** Target reference for scheduling */
export type SuiteRunTarget = {
  type: "http" | "prompt" | "code" | "workflow" | "connected";
  referenceId: string;
  /** The parameter overrides of this target alone. See `target-key.ts`. */
  runParameters?: RunParameterValues;
};

/**
 * The values each scenario resolved, per target, keyed by the target key and
 * then by scenario id. A target's overrides win over the run's values, so two
 * targets of one agent may resolve two different sets.
 */
export type ParametersByTargetKey = Map<
  string,
  Map<string, RunParameterValues>
>;

/**
 * The `parameters` entry for a queued run's metadata, or nothing at all when
 * the run resolved none. A run without parameters records the metadata it
 * always did rather than an empty object nothing reads.
 */
function withParameters(
  parameters: RunParameterValues | undefined,
): { parameters: RunParameterValues } | Record<string, never> {
  return parameters && Object.keys(parameters).length > 0 ? { parameters } : {};
}

/**
 * The `targetParameters` entry of the reserved langwatch namespace, or nothing
 * at all. Only the target's own overrides: a target with none records the
 * namespace it always did.
 */
function withTargetParameters(
  runParameters: RunParameterValues | undefined,
): { targetParameters: RunParameterValues } | Record<string, never> {
  return hasParameterOverrides(runParameters)
    ? { targetParameters: runParameters }
    : {};
}

/**
 * The `scenarioVersion` entry of the reserved langwatch namespace, or nothing
 * at all. The map built from the queue-time read holds every scheduled
 * scenario, so an absent entry only happens if a caller schedules a scenario
 * it never read; the run then records no version rather than an undefined.
 */
function withScenarioVersion(
  version: number | undefined,
): { scenarioVersion: number } | Record<string, never> {
  return version !== undefined ? { scenarioVersion: version } : {};
}

/**
 * The simulation models the plan was configured with, or nothing at all.
 *
 * A plan that names no model runs on the project default, and records no
 * model rather than the default's name: a configuration is what a person
 * chose, so the same choice has to key the same way after a project default
 * changes.
 *
 * @see specs/scenarios/run-configuration-on-runs.feature
 */
function withSimulationModels(models: {
  simulatorModel?: string | null;
  judgeModel?: string | null;
}): { simulatorModel?: string; judgeModel?: string } {
  return {
    ...(models.simulatorModel ? { simulatorModel: models.simulatorModel } : {}),
    ...(models.judgeModel ? { judgeModel: models.judgeModel } : {}),
  };
}

/**
 * The names of the secrets a run used, for the run's metadata.
 *
 * Names only. They are what lets a person see which credentials a run needed;
 * the values ride the event beside the metadata, encrypted, and never enter it.
 */
function withSecretParameterNames(
  secretParameters: RunSecretCiphertext | undefined,
): { secretParameterNames: string[] } | Record<string, never> {
  const names = Object.keys(secretParameters ?? {});
  return names.length > 0 ? { secretParameterNames: names } : {};
}

/**
 * The encrypted secret values, as a sibling of the metadata rather than a
 * member of it.
 *
 * The fold projection stringifies the metadata object into a stored column, so
 * a worker running an older build would copy anything inside it into the runs
 * store. A sibling field is dropped by that same worker instead.
 */
function withSecretParameters(
  secretParameters: RunSecretCiphertext | undefined,
): { secretParameters: RunSecretCiphertext } | Record<string, never> {
  return secretParameters && Object.keys(secretParameters).length > 0
    ? { secretParameters }
    : {};
}

/**
 * Report every enqueue the queue refused.
 *
 * A partial enqueue is otherwise invisible: the caller is handed the runs that
 * were queued and hears nothing about the rest, so the batch looks smaller
 * than it was asked for with no record of why.
 */
function logRejectedEnqueues({
  items,
  enqueued,
  suiteId,
  batchRunId,
}: {
  items: readonly { scenarioRunId: string; scenarioId: string }[];
  enqueued: readonly PromiseSettledResult<unknown>[];
  suiteId: string;
  batchRunId: string;
}): void {
  enqueued.forEach((result, index) => {
    if (result.status !== "rejected") return;
    logger.error(
      {
        suiteId,
        batchRunId,
        scenarioRunId: items[index]?.scenarioRunId,
        scenarioId: items[index]?.scenarioId,
        error: result.reason,
      },
      "Failed to queue a simulation run; it is left out of the batch",
    );
  });
}

/** What SuiteRunService reaches the rest of the platform through. */
export type SuiteRunServiceDependencies = {
  startSuiteRun: (data: StartSuiteRunCommandData) => Promise<void>;
  queueSimulationRun: (data: QueueRunCommandData) => Promise<void>;
  /**
   * Reads the models each run of the batch will run on, so every run says
   * which simulator played the person and which judge decided the verdict.
   * Absent in a context with no database behind it; the runs then record no
   * resolved model, the same as a run recorded before the field existed.
   */
  resolveRunModels?: RunModelsResolver;
};

export class SuiteRunService {
  constructor(
    readonly repository: SuiteRunReadRepository,
    private readonly deps: SuiteRunServiceDependencies,
  ) {}

  static create(
    params: SuiteRunServiceDependencies & {
      resolveClickHouseClient: ClickHouseClientResolver | null;
    },
  ): SuiteRunService {
    const repo = params.resolveClickHouseClient
      ? new SuiteRunClickHouseRepository(params.resolveClickHouseClient)
      : new NullSuiteRunReadRepository();
    return traced(new SuiteRunService(repo, params), "SuiteRunService");
  }

  /**
   * Start a suite run: dispatch the startSuiteRun command and schedule queue jobs.
   *
   * Generates the batchRunId upfront and returns it synchronously (before jobs
   * finish scheduling), so the frontend can navigate to the run page immediately.
   */
  async startRun(params: {
    suiteId: string;
    projectId: string;
    activeScenarioIds: string[];
    scenarioNameMap: Map<string, string>;
    /**
     * Each scenario's version from the same read that resolved the names, so
     * every queued run says which state of its scenario it ran. Stamped at
     * queue time: a later edit never changes what an old run says.
     */
    scenarioVersionMap: Map<string, number>;
    activeTargets: SuiteRunTarget[];
    repeatCount: number;
    skippedArchived: SuiteRunResult["skippedArchived"];
    idempotencyKey: string;
    batchRunId?: string;
    /**
     * The values each scenario resolved for this run, keyed by target key and
     * then by scenario id. Recorded on the queued event so the run reads back
     * with the values it actually ran against, and so the executor gets them
     * without a second resolution pass reaching a different answer.
     */
    parametersByTargetKey?: ParametersByTargetKey;
    /**
     * The secret values each scenario resolved, already encrypted, keyed by
     * scenario id. They ride the queued event beside the metadata so the run
     * carries them into execution without any store holding a readable
     * credential.
     */
    secretParametersByScenarioId?: Map<string, RunSecretCiphertext>;
    /**
     * One short line describing why this batch was run. Stamped onto every run
     * of the batch, so a run carries its note from its first moment.
     */
    note?: string;
    /**
     * The simulation models the plan was configured with. Stamped onto every
     * run so the run dialog can read a configuration back off the runs and
     * not only off the plan row.
     *
     * They also start the chain that resolves what each run really runs on,
     * which is stamped beside them.
     */
    simulatorModel?: string | null;
    judgeModel?: string | null;
    /**
     * The person who started this batch, stamped onto every run of it. Absent
     * when the caller named no person, which is every project-key run.
     *
     * @see specs/scenarios/run-actor-on-runs.feature
     */
    actor?: RunActor;
  }): Promise<SuiteRunResult> {
    const {
      suiteId,
      projectId,
      activeScenarioIds,
      scenarioNameMap,
      scenarioVersionMap,
      activeTargets,
      repeatCount,
      skippedArchived,
      idempotencyKey,
      parametersByTargetKey,
      secretParametersByScenarioId,
      note,
      actor,
    } = params;
    const simulationModels = withSimulationModels(params);
    // Read before the first run is queued: every run of the batch says which
    // models it ran on, and the answer must not change part way through it.
    const resolvedModelsByScenarioId: Map<string, ResolvedRunModels> =
      (await this.deps.resolveRunModels?.({
        projectId,
        scenarioIds: activeScenarioIds,
        plan: {
          simulatorModel: params.simulatorModel,
          judgeModel: params.judgeModel,
        },
      })) ?? new Map();

    const batchRunId = params.batchRunId ?? generateBatchRunId();
    const setId = getSuiteSetId(suiteId);
    const total = activeScenarioIds.length * activeTargets.length * repeatCount;

    logger.debug(
      {
        suiteId,
        projectId,
        batchRunId,
        activeScenarioCount: activeScenarioIds.length,
        activeTargetCount: activeTargets.length,
        repeatCount,
        total,
      },
      "Starting suite run",
    );

    await this.deps.startSuiteRun({
      tenantId: projectId,
      batchRunId,
      scenarioSetId: setId,
      suiteId,
      total,
      scenarioIds: activeScenarioIds,
      targetIds: activeTargets.map((t) => t.referenceId),
      idempotencyKey,
      occurredAt: Date.now(),
    });

    // Pre-generate scenarioRunIds and dispatch queueRun for each so QUEUED
    // entries appear in ClickHouse immediately. The same IDs are passed to the
    // SDK via RunOptions.runId (see scenario-child-process.ts), ensuring the
    // SDK's events use matching aggregate IDs.
    const items: Array<{
      scenarioId: string;
      target: SuiteRunTarget;
      repeat: number;
      scenarioRunId: string;
    }> = [];
    for (const scenarioId of activeScenarioIds) {
      for (const target of activeTargets) {
        for (let repeat = 0; repeat < repeatCount; repeat++) {
          items.push({
            scenarioId,
            target,
            repeat,
            scenarioRunId: generate(KSUID_RESOURCES.SCENARIO_RUN).toString(),
          });
        }
      }
    }

    const now = Date.now();
    const enqueued = await Promise.allSettled(
      items.map((item) => {
        const secretParameters = secretParametersByScenarioId?.get(
          item.scenarioId,
        );
        const targetKey = targetKeyOf(item.target);
        return this.deps.queueSimulationRun({
          tenantId: projectId,
          scenarioRunId: item.scenarioRunId,
          scenarioId: item.scenarioId,
          batchRunId,
          scenarioSetId: setId,
          name: scenarioNameMap.get(item.scenarioId),
          metadata: {
            langwatch: {
              targetReferenceId: item.target.referenceId,
              targetType: item.target.type,
              targetKey,
              ...withTargetParameters(item.target.runParameters),
              ...withScenarioVersion(scenarioVersionMap.get(item.scenarioId)),
              ...withActor(actor),
              ...simulationModels,
              ...withResolvedModels(
                resolvedModelsByScenarioId.get(item.scenarioId),
              ),
            },
            ...withNote(note),
            ...withParameters(
              parametersByTargetKey?.get(targetKey)?.get(item.scenarioId),
            ),
            ...withSecretParameterNames(secretParameters),
          },
          ...withSecretParameters(secretParameters),
          target: {
            type: item.target.type,
            referenceId: item.target.referenceId,
          },
          occurredAt: now,
        });
      }),
    );

    // An item whose enqueue was rejected has no run and never will, so it is
    // reported neither in the count nor in the list: a caller that waited on
    // its scenarioRunId would wait for a run that was never queued.
    const queuedItems = items.filter(
      (_, index) => enqueued[index]?.status === "fulfilled",
    );
    logRejectedEnqueues({ items, enqueued, suiteId, batchRunId });

    // No explicit job scheduling — the execution subscriber picks up queued events
    // via the GroupQueue and spawns child processes in the execution pool.

    logger.debug(
      {
        suiteId,
        batchRunId,
        itemCount: items.length,
        queuedCount: queuedItems.length,
      },
      "Suite run queued via event-sourcing",
    );

    return {
      batchRunId,
      setId,
      jobCount: queuedItems.length,
      skippedArchived,
      items: queuedItems.map((item) => ({
        scenarioRunId: item.scenarioRunId,
        scenarioId: item.scenarioId,
        target: item.target,
        name: scenarioNameMap.get(item.scenarioId),
      })),
    };
  }

  async getSuiteRunState(params: {
    projectId: string;
    batchRunId: string;
  }): Promise<SuiteRunStateData | null> {
    return this.repository.getSuiteRunState(params);
  }

  async getBatchHistory(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
  }): Promise<SuiteRunStateData[]> {
    return this.repository.getBatchHistory(params);
  }
}
