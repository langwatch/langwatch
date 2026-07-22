import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import { generateBatchRunId } from "~/server/scenarios/scenario.ids";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { KSUID_RESOURCES } from "~/utils/constants";
import { traced } from "../tracing";

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

export class SuiteRunService {
  constructor(
    private readonly queueSimulationRunCommand: (data: QueueRunCommandData) => Promise<void>,
  ) {}

  static create(params: {
    queueSimulationRun: (data: QueueRunCommandData) => Promise<void>;
  }): SuiteRunService {
    return traced(
      new SuiteRunService(params.queueSimulationRun),
      "SuiteRunService",
    );
  }

  /**
   * Start a suite run: queue one simulation run per scenario/target/repeat.
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
          target: { type: item.target.type, referenceId: item.target.referenceId },
          // The batch denominator travels with every child (ADR-061), so the
          // suite's progress is readable from the first row that lands.
          batchTotal: total,
          occurredAt: now,
        }),
      ),
    );

    // No explicit job scheduling — the execution reactor picks up queued events
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

}
