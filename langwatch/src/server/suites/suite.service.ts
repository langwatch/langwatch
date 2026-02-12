/**
 * Suite Service
 *
 * Business logic for simulation suite configurations.
 * Handles CRUD, duplication, and run scheduling.
 */

import { SpanKind } from "@opentelemetry/api";
import type {
  PrismaClient,
  SimulationSuiteConfiguration,
} from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import {
  SuiteRepository,
  type CreateSuiteInput,
  type UpdateSuiteInput,
} from "./suite.repository";
import { getSuiteSetId } from "./suite-set-id";
import {
  generateBatchRunId,
  scheduleScenarioRun,
  scenarioQueue,
} from "../scenarios/scenario.queue";
import { parseSuiteTargets, type SuiteTarget } from "./types";
import {
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  SuiteDomainError,
} from "./errors";
import { createLogger } from "~/utils/logger/server";

const tracer = getLangWatchTracer("langwatch.suites.service");
const logger = createLogger("langwatch:suites:service");

// Re-export for consumers that need the type
export type { SuiteTarget } from "./types";

/** Result of scheduling a suite run */
export type SuiteRunResult = {
  batchRunId: string;
  setId: string;
  jobCount: number;
};

/** Queue status counts for a suite's pending/active jobs */
export type QueueStatus = {
  waiting: number;
  active: number;
};

/** Dependencies for validating references before a run */
export interface SuiteRunDependencies {
  validateScenarioExists: (params: {
    id: string;
    projectId: string;
  }) => Promise<boolean>;
  validateTargetExists: (params: {
    referenceId: string;
    type: string;
    projectId: string;
  }) => Promise<boolean>;
}

export class SuiteService {
  constructor(private readonly repository: SuiteRepository) {}

  static fromPrisma(prisma: PrismaClient): SuiteService {
    return new SuiteService(new SuiteRepository(prisma));
  }

  async create(
    input: CreateSuiteInput,
  ): Promise<SimulationSuiteConfiguration> {
    return tracer.withActiveSpan(
      "SuiteService.create",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId: input.projectId }, "Creating suite");
        const result = await this.repository.create(input);
        span.setAttribute("suite.id", result.id);
        return result;
      },
    );
  }

  async getAll(params: {
    projectId: string;
  }): Promise<SimulationSuiteConfiguration[]> {
    return tracer.withActiveSpan(
      "SuiteService.getAll",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId: params.projectId }, "Fetching all suites");
        const result = await this.repository.findAll(params);
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  async getById(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuiteConfiguration | null> {
    return tracer.withActiveSpan(
      "SuiteService.getById",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, suiteId: params.id },
          "Fetching suite by id",
        );
        const result = await this.repository.findById(params);
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  async update(params: {
    id: string;
    projectId: string;
    data: UpdateSuiteInput;
  }): Promise<SimulationSuiteConfiguration> {
    return tracer.withActiveSpan(
      "SuiteService.update",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.id,
        },
      },
      async () => {
        logger.debug(
          { projectId: params.projectId, suiteId: params.id },
          "Updating suite",
        );
        return await this.repository.update(params);
      },
    );
  }

  async duplicate(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuiteConfiguration> {
    return tracer.withActiveSpan(
      "SuiteService.duplicate",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, suiteId: params.id },
          "Duplicating suite",
        );
        const original = await this.repository.findById(params);
        if (!original) {
          throw new SuiteDomainError("Suite not found");
        }
        const result = await this.repository.create({
          projectId: original.projectId,
          name: `${original.name} (copy)`,
          description: original.description,
          scenarioIds: original.scenarioIds,
          targets: parseSuiteTargets(original.targets),
          repeatCount: original.repeatCount,
          labels: original.labels,
        });
        span.setAttribute("suite.duplicated_id", result.id);
        return result;
      },
    );
  }

  async delete(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuiteConfiguration | null> {
    return tracer.withActiveSpan(
      "SuiteService.delete",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, suiteId: params.id },
          "Deleting suite",
        );
        const result = await this.repository.archive(params);
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Schedule a suite run.
   *
   * Validates all scenario and target references, then schedules
   * N scenarios x M targets x repeatCount jobs.
   *
   * @returns The batch run ID and job count
   * @throws {InvalidScenarioReferencesError} if any scenario references are invalid
   * @throws {InvalidTargetReferencesError} if any target references are invalid
   */
  async run(params: {
    suite: SimulationSuiteConfiguration;
    projectId: string;
    deps: SuiteRunDependencies;
  }): Promise<SuiteRunResult> {
    return tracer.withActiveSpan(
      "SuiteService.run",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.suite.id,
          "suite.scenario_count": params.suite.scenarioIds.length,
          "suite.repeat_count": params.suite.repeatCount,
        },
      },
      async (span) => {
        const { suite, projectId, deps } = params;
        const targets = parseSuiteTargets(suite.targets);
        span.setAttribute("suite.target_count", targets.length);

        await this.validateReferences({ suite, projectId, targets, deps });

        const batchRunId = generateBatchRunId();
        const setId = getSuiteSetId(suite.id);
        span.setAttribute("suite.batch_run_id", batchRunId);

        logger.info(
          {
            suiteId: suite.id,
            projectId,
            batchRunId,
            scenarioCount: suite.scenarioIds.length,
            targetCount: targets.length,
            repeatCount: suite.repeatCount,
          },
          "Scheduling suite run",
        );

        const jobCount = await this.scheduleJobs({
          suite,
          targets,
          projectId,
          setId,
          batchRunId,
        });

        span.setAttribute("suite.job_count", jobCount);

        logger.info(
          { suiteId: suite.id, batchRunId, jobCount },
          "Suite run scheduled",
        );

        return { batchRunId, setId, jobCount };
      },
    );
  }

  /**
   * Calculate the number of jobs for a suite run without scheduling.
   * Used for display and validation.
   */
  static calculateJobCount(params: {
    scenarioCount: number;
    targetCount: number;
    repeatCount: number;
  }): number {
    return params.scenarioCount * params.targetCount * params.repeatCount;
  }

  /**
   * Query the BullMQ queue for pending/active jobs belonging to a suite.
   *
   * Fetches waiting and active jobs from the scenario queue, then filters
   * by the suite's setId to return only jobs for this suite.
   */
  static async getQueueStatus(params: {
    suiteId: string;
  }): Promise<QueueStatus> {
    const setId = getSuiteSetId(params.suiteId);

    const jobs = await scenarioQueue.getJobs(["waiting", "active"]);

    let waiting = 0;
    let active = 0;

    for (const job of jobs) {
      if (job.data?.setId !== setId) continue;

      const state = await job.getState();
      if (state === "waiting") {
        waiting++;
      } else if (state === "active") {
        active++;
      }
    }

    return { waiting, active };
  }

  private async validateReferences(params: {
    suite: SimulationSuiteConfiguration;
    projectId: string;
    targets: SuiteTarget[];
    deps: SuiteRunDependencies;
  }): Promise<void> {
    const { suite, projectId, targets, deps } = params;

    const invalidScenarios: string[] = [];
    for (const scenarioId of suite.scenarioIds) {
      const exists = await deps.validateScenarioExists({
        id: scenarioId,
        projectId,
      });
      if (!exists) {
        invalidScenarios.push(scenarioId);
      }
    }
    if (invalidScenarios.length > 0) {
      throw new InvalidScenarioReferencesError({
        invalidIds: invalidScenarios,
      });
    }

    const invalidTargets: string[] = [];
    for (const target of targets) {
      const exists = await deps.validateTargetExists({
        referenceId: target.referenceId,
        type: target.type,
        projectId,
      });
      if (!exists) {
        invalidTargets.push(target.referenceId);
      }
    }
    if (invalidTargets.length > 0) {
      throw new InvalidTargetReferencesError({
        invalidIds: invalidTargets,
      });
    }
  }

  private async scheduleJobs(params: {
    suite: SimulationSuiteConfiguration;
    targets: SuiteTarget[];
    projectId: string;
    setId: string;
    batchRunId: string;
  }): Promise<number> {
    const { suite, targets, projectId, setId, batchRunId } = params;

    const jobPromises: Promise<{ id?: string | null }>[] = [];
    for (const scenarioId of suite.scenarioIds) {
      for (const target of targets) {
        for (let repeat = 0; repeat < suite.repeatCount; repeat++) {
          jobPromises.push(
            scheduleScenarioRun({
              projectId,
              scenarioId,
              target: { type: target.type, referenceId: target.referenceId },
              setId,
              batchRunId,
              trialIndex: repeat,
            }),
          );
        }
      }
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
          suiteId: suite.id,
          batchRunId,
          totalJobs: results.length,
          failedCount: rejected.length,
          succeededCount: fulfilled.length,
          errors: rejected.map((r) => String(r.reason)),
        },
        "Suite run scheduling partially failed, rolling back enqueued jobs",
      );

      // Roll back: remove all successfully enqueued jobs
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
