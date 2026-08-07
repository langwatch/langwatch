import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { SuiteRunStateData } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
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

/** Item pending queueRun dispatch, before ES dual-write shape is derived. */
type PendingSuiteRunItem = {
  scenarioId: string;
  target: SuiteRunTarget;
  repeat: number;
  scenarioRunId: string;
};

/**
 * Pre-generate scenarioRunIds and one pending item per (scenario, target,
 * repeat) tuple. The same IDs are passed to the SDK via RunOptions.runId
 * (see scenario-child-process.ts), ensuring the SDK's events use matching
 * aggregate IDs.
 */
const buildPendingSuiteRunItems = (params: {
  activeScenarioIds: string[];
  activeTargets: SuiteRunTarget[];
  repeatCount: number;
}): PendingSuiteRunItem[] => {
  const { activeScenarioIds, activeTargets, repeatCount } = params;
  const items: PendingSuiteRunItem[] = [];
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
  return items;
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

    // Dispatch queueRun for each pre-generated item so QUEUED entries appear
    // in ClickHouse immediately. No explicit job scheduling beyond that — the
    // execution reactor picks up queued events via the GroupQueue and spawns
    // child processes in the execution pool.
    const items = buildPendingSuiteRunItems({
      activeScenarioIds,
      activeTargets,
      repeatCount,
    });
    await this.dispatchQueueRunCommands({
      items,
      projectId,
      batchRunId,
      setId,
      scenarioNameMap,
    });

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

  /** Dispatches queueRun for every pending item, tolerating individual failures. */
  private async dispatchQueueRunCommands(params: {
    items: PendingSuiteRunItem[];
    projectId: string;
    batchRunId: string;
    setId: string;
    scenarioNameMap: Map<string, string>;
  }): Promise<void> {
    const { items, projectId, batchRunId, setId, scenarioNameMap } = params;
    const now = Date.now();
    await Promise.allSettled(
      items.map((item) =>
        this.queueSimulationRunCommand({
          tenantId: projectId,
          scenarioRunId: item.scenarioRunId,
          scenarioId: item.scenarioId,
          batchRunId,
          scenarioSetId: setId,
          name: scenarioNameMap.get(item.scenarioId),
          metadata: {
            langwatch: { targetReferenceId: item.target.referenceId },
          },
          target: {
            type: item.target.type,
            referenceId: item.target.referenceId,
          },
          occurredAt: now,
        }),
      ),
    );
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
