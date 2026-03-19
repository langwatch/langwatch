import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import type { SuiteRunStateData } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import {
  generateBatchRunId,
  scheduleScenarioRun,
  scenarioQueue,
} from "~/server/scenarios/scenario.queue";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createLogger } from "~/utils/logger/server";
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
  type: "http" | "prompt" | "code";
  referenceId: string;
};

export class SuiteRunService {
  constructor(
    readonly repository: SuiteRunReadRepository,
    private readonly startSuiteRunCommand: (data: StartSuiteRunCommandData) => Promise<void>,
    private readonly queueSimulationRunCommand: (data: QueueRunCommandData) => Promise<void>,
  ) {}

  static create(params: {
    clickhouse: ClickHouseClient | null;
    startSuiteRun: (data: StartSuiteRunCommandData) => Promise<void>;
    queueSimulationRun: (data: QueueRunCommandData) => Promise<void>;
  }): SuiteRunService {
    const repo = params.clickhouse
      ? new SuiteRunClickHouseRepository(params.clickhouse)
      : new NullSuiteRunReadRepository();
    return traced(new SuiteRunService(repo, params.startSuiteRun, params.queueSimulationRun), "SuiteRunService");
  }

  /**
   * Start a suite run: dispatch the startSuiteRun command and schedule BullMQ jobs.
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

    const batchRunId = generateBatchRunId();
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
    const items: Array<{ scenarioId: string; target: SuiteRunTarget; repeat: number; scenarioRunId: string }> = [];
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
          occurredAt: now,
        }),
      ),
    );

    const jobCount = await this.scheduleJobs({
      items,
      scenarioNameMap,
      suiteId,
      projectId,
      setId,
      batchRunId,
    });

    logger.debug(
      { suiteId, batchRunId, jobCount },
      "Suite run scheduled",
    );

    return {
      batchRunId,
      setId,
      jobCount,
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

  private async scheduleJobs(params: {
    items: Array<{ scenarioId: string; target: SuiteRunTarget; repeat: number; scenarioRunId: string }>;
    scenarioNameMap: Map<string, string>;
    suiteId: string;
    projectId: string;
    setId: string;
    batchRunId: string;
  }): Promise<number> {
    const { items, scenarioNameMap, suiteId, projectId, setId, batchRunId } = params;

    const jobPromises: Promise<{ id?: string | null }>[] = [];
    for (const item of items) {
      jobPromises.push(
        scheduleScenarioRun({
          projectId,
          scenarioId: item.scenarioId,
          scenarioName: scenarioNameMap.get(item.scenarioId) ?? item.scenarioId,
          target: { type: item.target.type, referenceId: item.target.referenceId },
          setId,
          batchRunId,
          index: item.repeat,
          scenarioRunId: item.scenarioRunId,
        }),
      );
    }

    const results = await Promise.allSettled(jobPromises);

    const fulfilled = results.filter(
      (r): r is PromiseSettledResult<{ id?: string | null }> & { status: "fulfilled" } =>
        r.status === "fulfilled",
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    if (rejected.length > 0) {
      logger.error(
        {
          suiteId,
          batchRunId,
          totalJobs: results.length,
          failedCount: rejected.length,
          succeededCount: fulfilled.length,
          errors: rejected.map((r) => String(r.reason)),
        },
        "Suite run scheduling partially failed, rolling back enqueued jobs",
      );

      await Promise.allSettled(
        fulfilled.map(async (r) => {
          const jobId = r.value.id;
          if (jobId) {
            const job = await scenarioQueue.getJob(jobId);
            await job?.remove();
          }
        }),
      );

      throw new Error(
        `Failed to schedule suite run: ${rejected.length} of ${results.length} jobs failed to enqueue`,
      );
    }

    return fulfilled.length;
  }
}
