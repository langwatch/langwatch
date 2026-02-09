/**
 * Suite Service
 *
 * Business logic for simulation suite configurations.
 * Handles CRUD, duplication, and run scheduling.
 */

import type {
  PrismaClient,
  SimulationSuiteConfiguration,
} from "@prisma/client";
import {
  SuiteRepository,
  type CreateSuiteInput,
  type UpdateSuiteInput,
} from "./suite.repository";
import { getSuiteSetId } from "./suite-set-id";
import {
  generateBatchRunId,
  scheduleScenarioRun,
} from "../scenarios/scenario.queue";
import {
  parseSuiteTargets,
  type SuiteTarget,
} from "../api/routers/suites/schemas";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:suites:service");

// Re-export for consumers that need the type
export type { SuiteTarget } from "../api/routers/suites/schemas";

/** Result of scheduling a suite run */
export type SuiteRunResult = {
  batchRunId: string;
  setId: string;
  jobCount: number;
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
    return this.repository.create(input);
  }

  async getAll(params: {
    projectId: string;
  }): Promise<SimulationSuiteConfiguration[]> {
    return this.repository.findAll(params);
  }

  async getById(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuiteConfiguration | null> {
    return this.repository.findById(params);
  }

  async update(params: {
    id: string;
    projectId: string;
    data: UpdateSuiteInput;
  }): Promise<SimulationSuiteConfiguration> {
    return this.repository.update(params);
  }

  async duplicate(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuiteConfiguration> {
    const original = await this.repository.findById(params);
    if (!original) {
      throw new Error("Suite not found");
    }
    return this.repository.create({
      projectId: original.projectId,
      name: `${original.name} (copy)`,
      description: original.description,
      scenarioIds: original.scenarioIds,
      targets: parseSuiteTargets(original.targets),
      repeatCount: original.repeatCount,
      labels: original.labels,
    });
  }

  async delete(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuiteConfiguration | null> {
    return this.repository.archive(params);
  }

  /**
   * Schedule a suite run.
   *
   * Validates all scenario and target references, then schedules
   * N scenarios x M targets x repeatCount jobs.
   *
   * @returns The batch run ID and job count
   * @throws Error if any scenario or target references are invalid
   */
  async run(params: {
    suite: SimulationSuiteConfiguration;
    projectId: string;
    deps: SuiteRunDependencies;
  }): Promise<SuiteRunResult> {
    const { suite, projectId, deps } = params;
    const targets = parseSuiteTargets(suite.targets);

    await this.validateReferences({ suite, projectId, targets, deps });

    const batchRunId = generateBatchRunId();
    const setId = getSuiteSetId(suite.id);

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

    logger.info(
      { suiteId: suite.id, batchRunId, jobCount },
      "Suite run scheduled",
    );

    return { batchRunId, setId, jobCount };
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
      throw new Error(
        `Invalid scenario references: ${invalidScenarios.join(", ")}`,
      );
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
      throw new Error(
        `Invalid target references: ${invalidTargets.join(", ")}`,
      );
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
    let jobCount = 0;

    for (const scenarioId of suite.scenarioIds) {
      for (const target of targets) {
        for (let repeat = 0; repeat < suite.repeatCount; repeat++) {
          await scheduleScenarioRun({
            projectId,
            scenarioId,
            target: { type: target.type, referenceId: target.referenceId },
            setId,
            batchRunId,
          });
          jobCount++;
        }
      }
    }

    return jobCount;
  }
}
