import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { SuiteRunStateData } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import type { RunParameterValues } from "@langwatch/scenario-contract";
import type { RunSecretCiphertext } from "~/server/scenarios/run-secret-values";
import { generateBatchRunId } from "~/server/scenarios/scenario.ids";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
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
  type: "http" | "prompt" | "code" | "workflow";
  referenceId: string;
};

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

export class SuiteRunService {
  constructor(
    readonly repository: SuiteRunReadRepository,
    private readonly startSuiteRunCommand: (
      data: StartSuiteRunCommandData,
    ) => Promise<void>,
    private readonly queueSimulationRunCommand: (
      data: QueueRunCommandData,
    ) => Promise<void>,
  ) {}

  static create(params: {
    resolveClickHouseClient: ClickHouseClientResolver | null;
    startSuiteRun: (data: StartSuiteRunCommandData) => Promise<void>;
    queueSimulationRun: (data: QueueRunCommandData) => Promise<void>;
  }): SuiteRunService {
    const repo = params.resolveClickHouseClient
      ? new SuiteRunClickHouseRepository(params.resolveClickHouseClient)
      : new NullSuiteRunReadRepository();
    return traced(
      new SuiteRunService(
        repo,
        params.startSuiteRun,
        params.queueSimulationRun,
      ),
      "SuiteRunService",
    );
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
    activeTargets: SuiteRunTarget[];
    repeatCount: number;
    skippedArchived: SuiteRunResult["skippedArchived"];
    idempotencyKey: string;
    batchRunId?: string;
    /**
     * The values each scenario resolved for this run, keyed by scenario id.
     * Recorded on the queued event so the run reads back with the values it
     * actually ran against, and so the executor gets them without a second
     * resolution pass reaching a different answer.
     */
    parametersByScenarioId?: Map<string, RunParameterValues>;
    /**
     * The secret values each scenario resolved, already encrypted, keyed by
     * scenario id. They ride the queued event beside the metadata so the run
     * carries them into execution without any store holding a readable
     * credential.
     */
    secretParametersByScenarioId?: Map<string, RunSecretCiphertext>;
  }): Promise<SuiteRunResult> {
    const {
      suiteId,
      projectId,
      activeScenarioIds,
      scenarioNameMap,
      activeTargets,
      repeatCount,
      skippedArchived,
      idempotencyKey,
      parametersByScenarioId,
      secretParametersByScenarioId,
    } = params;

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

    await this.startSuiteRunCommand({
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
    await Promise.allSettled(
      items.map((item) => {
        const secretParameters = secretParametersByScenarioId?.get(
          item.scenarioId,
        );
        return this.queueSimulationRunCommand({
          tenantId: projectId,
          scenarioRunId: item.scenarioRunId,
          scenarioId: item.scenarioId,
          batchRunId,
          scenarioSetId: setId,
          name: scenarioNameMap.get(item.scenarioId),
          metadata: {
            langwatch: { targetReferenceId: item.target.referenceId },
            ...withParameters(parametersByScenarioId?.get(item.scenarioId)),
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

    // No explicit job scheduling — the execution subscriber picks up queued events
    // via the GroupQueue and spawns child processes in the execution pool.

    logger.debug(
      { suiteId, batchRunId, itemCount: items.length },
      "Suite run queued via event-sourcing",
    );

    return {
      batchRunId,
      setId,
      jobCount: items.length,
      skippedArchived,
      items: items.map((item) => ({
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
