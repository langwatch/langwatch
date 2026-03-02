/**
 * Suite Service
 *
 * Business logic for simulation suites.
 * Handles CRUD, duplication, and run scheduling.
 */

import { SpanKind } from "@opentelemetry/api";
import type {
  PrismaClient,
  SimulationSuite,
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
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  SuiteDomainError,
} from "./errors";

import { createLogger } from "~/utils/logger/server";
import { slugify } from "~/utils/slugify";
import { ScenarioRepository } from "../scenarios/scenario.repository";
import { AgentRepository } from "../agents/agent.repository";
import { LlmConfigRepository } from "../prompt-config/repositories/llm-config.repository";

const tracer = getLangWatchTracer("langwatch.suites.service");
const logger = createLogger("langwatch:suites:service");

// Re-export for consumers that need the type
export type { SuiteTarget } from "./types";

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

/** Queue status counts for a suite's pending/active jobs */
export type QueueStatus = {
  waiting: number;
  active: number;
};

/** Result of resolving scenario references against the database */
type ResolvedScenarioReferences = {
  active: string[];
  archived: string[];
  missing: string[];
};

/** Result of resolving target references against the database */
type ResolvedTargetReferences = {
  active: SuiteTarget[];
  archived: SuiteTarget[];
  missing: SuiteTarget[];
};

export class SuiteService {
  constructor(
    private readonly repository: SuiteRepository,
    private readonly scenarioRepository: ScenarioRepository,
    private readonly agentRepository: AgentRepository,
    private readonly llmConfigRepository: LlmConfigRepository,
  ) {}

  /**
   * Static factory method for creating a SuiteService with proper DI.
   */
  static create(prisma: PrismaClient): SuiteService {
    return new SuiteService(
      new SuiteRepository(prisma),
      new ScenarioRepository(prisma),
      new AgentRepository(prisma),
      new LlmConfigRepository(prisma),
    );
  }

  async create(
    input: Omit<CreateSuiteInput, "slug">,
  ): Promise<SimulationSuite> {
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
        const slug = slugify(input.name);
        await this.ensureSlugAvailable({
          slug,
          projectId: input.projectId,
        });
        const result = await this.repository.create({ ...input, slug });
        span.setAttribute("suite.id", result.id);
        return result;
      },
    );
  }

  async getAll(params: {
    projectId: string;
  }): Promise<SimulationSuite[]> {
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
  }): Promise<SimulationSuite | null> {
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
    data: Omit<UpdateSuiteInput, "slug">;
  }): Promise<SimulationSuite> {
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
        const data: UpdateSuiteInput = { ...params.data };
        if (params.data.name) {
          const slug = slugify(params.data.name);
          await this.ensureSlugAvailable({
            slug,
            projectId: params.projectId,
            excludeId: params.id,
          });
          data.slug = slug;
        }
        return await this.repository.update({
          id: params.id,
          projectId: params.projectId,
          data,
        });
      },
    );
  }

  async duplicate(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuite> {
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
        const newName = `${original.name} (copy)`;
        const slug = slugify(newName);
        await this.ensureSlugAvailable({
          slug,
          projectId: original.projectId,
        });
        const result = await this.repository.create({
          projectId: original.projectId,
          name: newName,
          slug,
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

  async archive(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuite | null> {
    return tracer.withActiveSpan(
      "SuiteService.archive",
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
          "Archiving suite",
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
   * Resolves all scenario and target references, filtering out archived ones.
   * Schedules N active-scenarios x M active-targets x repeatCount jobs.
   *
   * @returns The batch run ID, job count, and any skipped archived references
   * @throws {InvalidScenarioReferencesError} if any scenario references are missing (deleted)
   * @throws {InvalidTargetReferencesError} if any target references are missing (deleted)
   * @throws {AllScenariosArchivedError} if all scenarios are archived
   * @throws {AllTargetsArchivedError} if all targets are archived
   */
  async run(params: {
    suite: SimulationSuite;
    projectId: string;
    organizationId: string;
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
        const { suite, projectId, organizationId } = params;
        const targets = parseSuiteTargets(suite.targets);
        span.setAttribute("suite.target_count", targets.length);

        const resolved = await this.resolveReferences({ suite, projectId, organizationId, targets });

        const batchRunId = generateBatchRunId();
        const setId = getSuiteSetId(suite.id);
        span.setAttribute("suite.batch_run_id", batchRunId);

        logger.info(
          {
            suiteId: suite.id,
            projectId,
            batchRunId,
            activeScenarioCount: resolved.activeScenarioIds.length,
            activeTargetCount: resolved.activeTargets.length,
            skippedArchivedScenarios: resolved.skippedArchived.scenarios.length,
            skippedArchivedTargets: resolved.skippedArchived.targets.length,
            repeatCount: suite.repeatCount,
          },
          "Scheduling suite run",
        );

        const jobCount = await this.scheduleJobs({
          scenarioIds: resolved.activeScenarioIds,
          targets: resolved.activeTargets,
          suiteId: suite.id,
          projectId,
          setId,
          batchRunId,
          repeatCount: suite.repeatCount,
        });

        span.setAttribute("suite.job_count", jobCount);

        logger.info(
          { suiteId: suite.id, batchRunId, jobCount },
          "Suite run scheduled",
        );

        return {
          batchRunId,
          setId,
          jobCount,
          skippedArchived: resolved.skippedArchived,
        };
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

    const [waitingJobs, activeJobs] = await Promise.all([
      scenarioQueue.getJobs(["waiting"]),
      scenarioQueue.getJobs(["active"]),
    ]);

    const waiting = waitingJobs.filter((job) => job.data?.setId === setId).length;
    const active = activeJobs.filter((job) => job.data?.setId === setId).length;

    return { waiting, active };
  }

  /**
   * Check that the slug is not already taken within the project.
   * Optionally exclude a specific suite ID (for updates).
   */
  private async ensureSlugAvailable(params: {
    slug: string;
    projectId: string;
    excludeId?: string;
  }): Promise<void> {
    const existing = await this.repository.findBySlug({
      slug: params.slug,
      projectId: params.projectId,
    });
    if (existing && existing.id !== params.excludeId) {
      throw new SuiteDomainError("A suite with this name already exists");
    }
  }

  private async resolveReferences(params: {
    suite: SimulationSuite;
    projectId: string;
    organizationId: string;
    targets: SuiteTarget[];
  }): Promise<{
    activeScenarioIds: string[];
    activeTargets: SuiteTarget[];
    skippedArchived: SuiteRunResult["skippedArchived"];
  }> {
    const { suite, projectId, organizationId, targets } = params;

    const scenarioResolution = await this.resolveScenarioReferences({
      ids: suite.scenarioIds,
      projectId,
    });

    if (scenarioResolution.missing.length > 0) {
      throw new InvalidScenarioReferencesError({
        invalidIds: scenarioResolution.missing,
      });
    }

    if (scenarioResolution.active.length === 0) {
      throw new AllScenariosArchivedError();
    }

    const targetResolution = await this.resolveTargetReferences({
      targets,
      projectId,
      organizationId,
    });

    if (targetResolution.missing.length > 0) {
      throw new InvalidTargetReferencesError({
        invalidIds: targetResolution.missing.map((t) => t.referenceId),
      });
    }

    if (targetResolution.active.length === 0) {
      throw new AllTargetsArchivedError();
    }

    return {
      activeScenarioIds: scenarioResolution.active,
      activeTargets: targetResolution.active,
      skippedArchived: {
        scenarios: scenarioResolution.archived,
        targets: targetResolution.archived.map((t) => t.referenceId),
      },
    };
  }

  private async resolveScenarioReferences(params: {
    ids: string[];
    projectId: string;
  }): Promise<ResolvedScenarioReferences> {
    const { ids, projectId } = params;

    const rows = await this.scenarioRepository.findManyIncludingArchived({ ids, projectId });
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    const active: string[] = [];
    const archived: string[] = [];
    const missing: string[] = [];

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        missing.push(id);
      } else if (row.archivedAt) {
        archived.push(id);
      } else {
        active.push(id);
      }
    }

    return { active, archived, missing };
  }

  /**
   * Resolve target references in batch, classifying each as active/archived/missing.
   *
   * Prompt targets (`type: "prompt"`) use `deletedAt` (soft-delete) rather than
   * `archivedAt`, so they can only be "active" or "missing" -- never "archived".
   * This asymmetry exists because LlmPromptConfig does not yet support `archivedAt`.
   * See: https://github.com/langwatch/langwatch/issues/1889
   */
  private async resolveTargetReferences(params: {
    targets: SuiteTarget[];
    projectId: string;
    organizationId: string;
  }): Promise<ResolvedTargetReferences> {
    const { targets, projectId, organizationId } = params;

    // Partition targets by type
    const httpTargets = targets.filter((t) => t.type === "http");
    const promptTargets = targets.filter((t) => t.type === "prompt");
    const unknownTargets = targets.filter((t) => t.type !== "http" && t.type !== "prompt");

    // Batch HTTP targets
    const httpRows = httpTargets.length > 0
      ? await this.agentRepository.findManyIncludingArchived({
          ids: httpTargets.map((t) => t.referenceId),
          projectId,
        })
      : [];
    const httpMap = new Map(httpRows.map((r) => [r.id, r]));

    // Batch prompt targets
    const promptExistingIds = promptTargets.length > 0
      ? await this.llmConfigRepository.findExistingIds({
          ids: promptTargets.map((t) => t.referenceId),
          projectId,
          organizationId,
        })
      : new Set<string>();

    const active: SuiteTarget[] = [];
    const archived: SuiteTarget[] = [];
    const missing: SuiteTarget[] = [];

    for (const target of httpTargets) {
      const row = httpMap.get(target.referenceId);
      if (!row) {
        missing.push(target);
      } else if (row.archivedAt) {
        archived.push(target);
      } else {
        active.push(target);
      }
    }

    for (const target of promptTargets) {
      if (promptExistingIds.has(target.referenceId)) {
        active.push(target);
      } else {
        missing.push(target);
      }
    }

    for (const target of unknownTargets) {
      missing.push(target);
    }

    return { active, archived, missing };
  }

  private async scheduleJobs(params: {
    scenarioIds: string[];
    targets: SuiteTarget[];
    suiteId: string;
    projectId: string;
    setId: string;
    batchRunId: string;
    repeatCount: number;
  }): Promise<number> {
    const { scenarioIds, targets, projectId, setId, batchRunId, repeatCount } = params;

    const jobPromises: Promise<{ id?: string | null }>[] = [];
    for (const scenarioId of scenarioIds) {
      for (const target of targets) {
        for (let repeat = 0; repeat < repeatCount; repeat++) {
          jobPromises.push(
            scheduleScenarioRun({
              projectId,
              scenarioId,
              target: { type: target.type, referenceId: target.referenceId },
              setId,
              batchRunId,
              index: repeat,
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
          suiteId: params.suiteId,
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
