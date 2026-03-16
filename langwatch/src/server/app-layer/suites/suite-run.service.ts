import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import type { SuiteRunStateData } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import { generateBatchRunId } from "~/server/scenarios/scenario.queue";
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

/** Result of scheduling a suite run */
export type SuiteRunResult = {
  batchRunId: string;
  setId: string;
  jobCount: number;
  skippedArchived: {
    scenarios: string[];
    targets: string[];
  };
};

/** Target reference for scheduling */
export type SuiteRunTarget = {
  type: "http" | "prompt";
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

    // Pre-generate scenarioRunIds and dispatch queueRun for each
    // so PENDING entries appear in ClickHouse immediately
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
    const queueResults = await Promise.allSettled(
      items.map((item) =>
        this.queueSimulationRunCommand({
          tenantId: projectId,
          scenarioRunId: item.scenarioRunId,
          scenarioId: item.scenarioId,
          batchRunId,
          scenarioSetId: setId,
          name: scenarioNameMap.get(item.scenarioId),
          target: { type: item.target.type, referenceId: item.target.referenceId },
          occurredAt: now,
        }),
      ),
    );

    // Check for partial failures and rollback succeeded ones
    const fulfilled = queueResults.filter((r) => r.status === "fulfilled");
    const rejected = queueResults.filter((r) => r.status === "rejected");

    if (rejected.length > 0) {
      logger.error(
        {
          suiteId,
          batchRunId,
          totalJobs: queueResults.length,
          failedCount: rejected.length,
          succeededCount: fulfilled.length,
          errors: rejected.map((r) => String((r as PromiseRejectedResult).reason)),
        },
        "Suite run queueing partially failed",
      );

      throw new Error(
        `Failed to queue suite run: ${rejected.length} of ${queueResults.length} runs failed`,
      );
    }

    logger.debug(
      { suiteId, batchRunId, jobCount: fulfilled.length },
      "Suite run scheduled",
    );

    return { batchRunId, setId, jobCount: fulfilled.length, skippedArchived };
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
