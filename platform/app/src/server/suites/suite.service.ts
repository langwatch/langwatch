/**
 * Suite Service
 *
 * Business logic for simulation suites.
 * Handles CRUD, duplication, and run scheduling.
 */

import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type {
  Prisma,
  PrismaClient,
  SimulationSuite,
} from "~/generated/prisma/client";
import type {
  SuiteRunResult,
  SuiteRunService,
} from "~/server/app-layer/suites/suite-run.service";
import { isUniqueConstraintError } from "~/server/utils/prismaErrors";
import { slugify } from "~/utils/slugify";
import { AgentRepository } from "../agents/agent.repository";
import { LlmConfigRepository } from "../prompt-config/repositories/llm-config.repository";
import type { RunParameterValues } from "../scenarios/parameters";
import { resolveRunParameters } from "../scenarios/resolve-run-parameters";
import {
  encryptRunSecretValues,
  type RunSecretCiphertext,
} from "../scenarios/run-secret-values";
import {
  ScenarioRepository,
  type ScenarioRunConfig,
} from "../scenarios/scenario.repository";
import { RUN_ALL_SUITE_LABEL, RUN_ALL_SUITE_NAME } from "./constants";
import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  SuiteNameTakenError,
  SuiteNotFoundError,
  SuiteScopeEmptyError,
  SuiteScopeNotAllowedError,
  SuiteTargetsRequiredError,
} from "./errors";
import { normalizePlanScope, sortSuiteTargets } from "./plan-config";
import { isDynamicScope, parseSuiteScope, type SuiteScope } from "./scope";
import { readScopeMembership } from "./scope-membership";
import { pickFreeSlug } from "./slug";
import {
  type CreateSuiteInput,
  SuiteRepository,
  type UpdateSuiteInput,
} from "./suite.repository";
import {
  isSuiteAgentTargetType,
  parseSuiteTargets,
  type SuiteKind,
  type SuiteTarget,
} from "./types";

const tracer = getLangWatchTracer("langwatch.suites.service");
const logger = createLogger("langwatch:suites:service");

export type { SuiteRunResult } from "~/server/app-layer/suites/suite-run.service";
// Re-export for consumers that need the type
export type { SuiteTarget } from "./types";

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

/**
 * Resolves the values each scenario of a run reads, split into the plain ones
 * the child reads as `params` and the secret ones it reads as `secrets`.
 *
 * The secrets are encrypted here, at the last point that holds them in clear,
 * so the queued event and everything folded from it carry ciphertext. Only
 * scenarios that resolved at least one secret get an entry.
 */
async function resolveParameterMaps(params: {
  scenarios: readonly ScenarioRunConfig[];
  values?: RunParameterValues;
}): Promise<{
  parametersByScenarioId: Map<string, RunParameterValues>;
  secretParametersByScenarioId: Map<string, RunSecretCiphertext>;
}> {
  const resolved = await resolveRunParameters({
    scenarios: params.scenarios,
    values: params.values,
  });
  return {
    parametersByScenarioId: new Map(
      [...resolved].map(([scenarioId, scenarioParameters]) => [
        scenarioId,
        scenarioParameters.parameters,
      ]),
    ),
    secretParametersByScenarioId: new Map(
      [...resolved]
        .filter(
          ([, scenarioParameters]) =>
            Object.keys(scenarioParameters.secretParameters).length > 0,
        )
        .map(([scenarioId, scenarioParameters]) => [
          scenarioId,
          encryptRunSecretValues(scenarioParameters.secretParameters),
        ]),
    ),
  };
}

/**
 * The two things a test suite refuses in an update.
 *
 * Both are a second answer to what the suite runs, which its own filing
 * already decides: a scope is a rule over the whole project, and a member list
 * is derived from `Scenario.folderId` by reconcileFolderMembership and nothing
 * else, so a direct write here would fork the two sides of that invariant.
 */
function assertFolderUpdate(data: UpdateSuiteInput): void {
  if (data.scope !== undefined && data.scope !== null) {
    throw new SuiteScopeNotAllowedError();
  }
  if (data.scenarioIds !== undefined) {
    throw new ValidationError(
      "A folder's scenarios are managed by filing scenarios into it",
      {
        meta: {
          fieldErrors: {
            scenarioIds: [
              "A folder's scenarios are managed by filing scenarios into it",
            ],
          },
        },
      },
    );
  }
}

/**
 * The config a run plan is started with, as the caller sends it.
 *
 * The stored form fills the optional fields in and sorts the targets; see
 * `PlanConfig` in ./plan-config.ts.
 */
export type RunPlanConfigInput = {
  scope: SuiteScope;
  targets: SuiteTarget[];
  repeatCount?: number;
  simulatorModel?: string | null;
  judgeModel?: string | null;
  /**
   * The scenarios a hand-picked scope covers. A `cases` scope names no
   * scenario in the rule itself, so the plan runs what it stores here.
   */
  scenarioIds?: string[];
};

export class SuiteService {
  constructor(
    private readonly repository: SuiteRepository,
    private readonly scenarioRepository: ScenarioRepository,
    private readonly agentRepository: AgentRepository,
    private readonly llmConfigRepository: LlmConfigRepository,
    private readonly suiteRunService: SuiteRunService,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Static factory method for creating a SuiteService with proper DI.
   */
  static create(params: {
    prisma: PrismaClient;
    suiteRunService: SuiteRunService;
  }): SuiteService {
    return new SuiteService(
      new SuiteRepository(params.prisma),
      new ScenarioRepository(params.prisma),
      new AgentRepository(params.prisma),
      new LlmConfigRepository(params.prisma),
      params.suiteRunService,
      params.prisma,
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

  /**
   * Lists the project's suites of the given kinds.
   *
   * The default is deliberately "custom" only: every caller that predates
   * folders, the v1 run plan list and the public suites endpoint, names no
   * kind, and must never see a folder row (an empty folder would render 0/0
   * there and refuse to run). A caller that wants folders says so.
   */
  async getAll(params: {
    projectId: string;
    kinds?: SuiteKind[];
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
        const result = await this.repository.findAll({
          projectId: params.projectId,
          kinds: params.kinds ?? ["custom"],
        });
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  /**
   * Creates an empty folder. Unlike a custom run plan, a folder starts with
   * no scenarios and no targets: scenarios arrive through filing, targets
   * through the run dialog.
   *
   * Folder and plan slugs share one per-project namespace, so a name another
   * suite already uses gets a numeric suffix instead of a refusal: a person
   * naming a folder must not be blocked by a run plan they may not even see.
   */
  async createFolder(params: {
    projectId: string;
    name: string;
  }): Promise<SimulationSuite> {
    return tracer.withActiveSpan(
      "SuiteService.createFolder",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        const name = params.name.trim();
        const baseSlug = slugify(name);
        if (!name || !baseSlug) {
          throw new ValidationError("A folder needs a name", {
            meta: { fieldErrors: { name: ["A folder needs a name"] } },
          });
        }
        const initialSlug = await this.generateUniqueSlug({
          baseSlug,
          projectId: params.projectId,
        });
        const result = await this.saveWithSlugRetry({
          initialSlug,
          execute: (slug) =>
            this.repository.create({
              projectId: params.projectId,
              name,
              slug,
              kind: "folder",
              scenarioIds: [],
              targets: [],
              repeatCount: 1,
              labels: [],
            }),
          regenerateSlug: () =>
            this.generateUniqueSlug({
              baseSlug,
              projectId: params.projectId,
            }),
        });
        span.setAttribute("suite.id", result.id);
        return result;
      },
    );
  }

  async getAllFolders(params: {
    projectId: string;
  }): Promise<SimulationSuite[]> {
    return this.getAll({ projectId: params.projectId, kinds: ["folder"] });
  }

  /**
   * Renames a folder. The slug stays as it was: run history routes and the
   * folder's internal run set are addressed through it, so a rename must not
   * break either.
   */
  async renameFolder(params: {
    projectId: string;
    folderId: string;
    name: string;
  }): Promise<SimulationSuite> {
    return tracer.withActiveSpan(
      "SuiteService.renameFolder",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.folderId,
        },
      },
      async () => {
        const name = params.name.trim();
        if (!name) {
          throw new ValidationError("A folder needs a name", {
            meta: { fieldErrors: { name: ["A folder needs a name"] } },
          });
        }
        const folder = await this.repository.findById({
          id: params.folderId,
          projectId: params.projectId,
        });
        if (folder?.kind !== "folder") {
          throw new SuiteNotFoundError();
        }
        return await this.repository.update({
          id: params.folderId,
          projectId: params.projectId,
          data: { name },
        });
      },
    );
  }

  /**
   * Archives a folder and every scenario filed in it, in one transaction.
   *
   * Constraint: the folder's scenarioIds is NOT recomputed here. The archived
   * folder keeps the membership it had as a readable snapshot, which is what
   * a future restore needs. This is the one place the membership invariant is
   * deliberately suspended (see server/suites/folder-membership.ts).
   *
   * Idempotent: archiving an archived folder keeps its original archive time
   * and touches no scenario.
   */
  async archiveFolder(params: {
    projectId: string;
    folderId: string;
  }): Promise<SimulationSuite> {
    return tracer.withActiveSpan(
      "SuiteService.archiveFolder",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.folderId,
        },
      },
      async () => {
        return await this.prisma.$transaction(async (tx) => {
          const folder = await tx.simulationSuite.findFirst({
            where: {
              id: params.folderId,
              projectId: params.projectId,
              kind: "folder",
            },
            select: { id: true },
          });
          if (!folder) {
            throw new SuiteNotFoundError();
          }
          await this.scenarioRepository.archiveManyByFolder({
            projectId: params.projectId,
            folderId: params.folderId,
            tx,
          });
          const archived = await this.repository.archive({
            id: params.folderId,
            projectId: params.projectId,
            tx,
          });
          if (!archived) {
            throw new SuiteNotFoundError();
          }
          return archived;
        });
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
        const existing = await this.repository.findById({
          id: params.id,
          projectId: params.projectId,
        });
        if (!existing) {
          throw new SuiteNotFoundError();
        }
        const data: UpdateSuiteInput = { ...params.data };
        if (existing.kind === "folder") {
          assertFolderUpdate(data);
          // A folder rename keeps its slug (see renameFolder), so no re-slug.
        } else if (params.data.name) {
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
          throw new SuiteNotFoundError();
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
          // A copy covers what the original covers, rule included.
          ...(original.scope !== null && {
            scope: original.scope as Prisma.InputJsonValue,
          }),
          targets: parseSuiteTargets(original.targets),
          repeatCount: original.repeatCount,
          labels: original.labels,
          simulatorModel: original.simulatorModel,
          judgeModel: original.judgeModel,
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
   * @throws {ScenarioParameterUnknownError} if a supplied parameter name is
   *   declared by no scenario in the run
   * @throws {ScenarioParameterMissingError} if a scenario's text reads a
   *   parameter the run resolved no value for
   * @throws {ScenarioParameterTemplateInvalidError} if a scenario that
   *   declares parameters has text that cannot be rendered
   */
  async run(params: {
    suite: SimulationSuite;
    projectId: string;
    organizationId: string;
    idempotencyKey: string;
    batchRunId?: string;
    /** Values supplied for the run, overriding each scenario's own defaults. */
    parameters?: RunParameterValues;
    /** One short line describing why this batch was run. */
    note?: string;
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

        // A suite with no target at all, a folder before its first run,
        // is refused before anything is resolved or scheduled.
        if (targets.length === 0) {
          throw new SuiteTargetsRequiredError();
        }

        const resolved = await this.resolveReferences({
          scenarioIds: await this.readRunMembership({ suite, projectId }),
          projectId,
          organizationId,
          targets,
        });

        const { parametersByScenarioId, secretParametersByScenarioId } =
          await resolveParameterMaps({
            scenarios: resolved.scenarioConfigs,
            values: params.parameters,
          });

        const result = await this.suiteRunService.startRun({
          suiteId: suite.id,
          projectId,
          activeScenarioIds: resolved.activeScenarioIds,
          scenarioNameMap: resolved.scenarioNameMap,
          scenarioVersionMap: resolved.scenarioVersionMap,
          activeTargets: resolved.activeTargets,
          repeatCount: suite.repeatCount,
          skippedArchived: resolved.skippedArchived,
          idempotencyKey: params.idempotencyKey,
          batchRunId: params.batchRunId,
          parametersByScenarioId,
          secretParametersByScenarioId,
          note: params.note,
        });

        span.setAttribute("suite.batch_run_id", result.batchRunId);
        span.setAttribute("suite.job_count", result.jobCount);

        return result;
      },
    );
  }

  /**
   * The scenarios a run covers.
   *
   * A folder's membership is read from the scenarios that name it, archived
   * ones included: the folder's scenarioIds cache holds only active members,
   * and the run reports the archived ones as skipped.
   *
   * Any other suite covers what its scope says. A dynamic scope is resolved
   * against the project as it is right now and written back onto the plan, so
   * a case written after the plan runs without the plan being edited. A plan
   * with no scope, or one of mode "cases", runs the scenarioIds it stores.
   *
   * @throws {SuiteScopeEmptyError} when a dynamic scope covers no case.
   */
  private async readRunMembership(params: {
    suite: SimulationSuite;
    projectId: string;
  }): Promise<string[]> {
    if (params.suite.kind === "folder") {
      const members = await this.scenarioRepository.findManyByFolder({
        projectId: params.projectId,
        folderId: params.suite.id,
      });
      return members.map((member) => member.id);
    }

    const scope = parseSuiteScope(params.suite.scope);
    if (!isDynamicScope(scope)) {
      return params.suite.scenarioIds;
    }

    const resolved = await readScopeMembership({
      projectId: params.projectId,
      suiteId: params.suite.id,
      scope,
      storedScenarioIds: params.suite.scenarioIds,
      prisma: this.prisma,
    });
    if (resolved.length === 0) {
      throw new SuiteScopeEmptyError();
    }
    return resolved;
  }

  /**
   * Runs every non-archived scenario of the project through the managed
   * "All scenarios" suite.
   *
   * The suite is a per-project singleton found by {@link RUN_ALL_SUITE_LABEL}
   * (never by name, since a person may name their own plan "All scenarios"). Its
   * scenarioIds are refreshed to all active scenarios at each run, and the
   * targets chosen in the run dialog are persisted onto it so the next run
   * preselects them. It is a kind "custom" suite, so v1 lists it as an
   * ordinary run plan and its history lands in its own internal run set.
   */
  async runAll(params: {
    projectId: string;
    organizationId: string;
    idempotencyKey: string;
    batchRunId?: string;
    targets?: SuiteTarget[];
    parameters?: RunParameterValues;
    note?: string;
  }): Promise<SuiteRunResult & { suiteId: string }> {
    return tracer.withActiveSpan(
      "SuiteService.runAll",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        const activeScenarioIds = (
          await this.scenarioRepository.findAll({
            projectId: params.projectId,
          })
        ).map((scenario) => scenario.id);

        const existing = await this.repository.findFirstByLabel({
          projectId: params.projectId,
          label: RUN_ALL_SUITE_LABEL,
        });

        let suite: SimulationSuite;
        if (existing) {
          suite = await this.repository.update({
            id: existing.id,
            projectId: params.projectId,
            data: {
              scenarioIds: activeScenarioIds,
              ...(params.targets !== undefined && { targets: params.targets }),
            },
          });
        } else {
          const baseSlug = slugify(RUN_ALL_SUITE_NAME);
          const initialSlug = await this.generateUniqueSlug({
            baseSlug,
            projectId: params.projectId,
          });
          suite = await this.saveWithSlugRetry({
            initialSlug,
            execute: (slug) =>
              this.repository.create({
                projectId: params.projectId,
                name: RUN_ALL_SUITE_NAME,
                slug,
                kind: "custom",
                scenarioIds: activeScenarioIds,
                targets: params.targets ?? [],
                repeatCount: 1,
                labels: [RUN_ALL_SUITE_LABEL],
              }),
            regenerateSlug: () =>
              this.generateUniqueSlug({
                baseSlug,
                projectId: params.projectId,
              }),
          });
        }
        span.setAttribute("suite.id", suite.id);

        const result = await this.run({
          suite,
          projectId: params.projectId,
          organizationId: params.organizationId,
          idempotencyKey: params.idempotencyKey,
          batchRunId: params.batchRunId,
          parameters: params.parameters,
          note: params.note,
        });
        return { ...result, suiteId: suite.id };
      },
    );
  }

  /**
   * Starts a run under a NAME, which is what identifies a run plan.
   *
   * - the name matches a run plan of this project: the run joins that plan and
   *   the plan's config is replaced with what the caller sent;
   * - nothing matches: a plan is created with that name and that config.
   *
   * So keeping the suggested name lands a person on the plan they expect, and
   * typing a new one forks a plan.
   *
   * Two things this deliberately does, both of which were bugs in the
   * prototype:
   *
   * - On a match only the config is replaced. The plan's own name and its own
   *   slug are left alone. A plan whose name was only ever suggested must not
   *   rename itself when its config is replaced, or it stops answering to the
   *   name the caller just resolved it by, and its run history moves address.
   * - Neither the plan id nor the plan slug is derived from the config. Two
   *   plans may hold one config and differ only by name, so a config-derived
   *   key collides. The slug comes from the NAME, through the same
   *   numeric-suffix retry every other suite slug uses.
   *
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  async runPlan(params: {
    projectId: string;
    organizationId: string;
    name: string;
    config: RunPlanConfigInput;
    idempotencyKey: string;
    batchRunId?: string;
    parameters?: RunParameterValues;
    note?: string;
  }): Promise<
    SuiteRunResult & { suiteId: string; planName: string; created: boolean }
  > {
    return tracer.withActiveSpan(
      "SuiteService.runPlan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        const name = params.name.trim();
        if (!name) {
          throw new ValidationError("A run needs a name", {
            meta: { fieldErrors: { name: ["A run needs a name"] } },
          });
        }

        const { suite, created } = await this.resolvePlanByName({
          projectId: params.projectId,
          name,
          config: params.config,
        });
        span.setAttribute("suite.id", suite.id);
        span.setAttribute("suite.plan_created", created);

        const result = await this.run({
          suite,
          projectId: params.projectId,
          organizationId: params.organizationId,
          idempotencyKey: params.idempotencyKey,
          batchRunId: params.batchRunId,
          parameters: params.parameters,
          note: params.note,
        });
        return {
          ...result,
          suiteId: suite.id,
          planName: suite.name,
          created,
        };
      },
    );
  }

  /**
   * The plan a name resolves to, matched or created, holding the given config.
   *
   * On a match ONLY the config is replaced. The plan keeps its own name and
   * its own slug.
   *
   * Its name, because a name is what a plan is: the match is made trimmed and
   * without case, so writing the caller's spelling back would rename "Nightly"
   * to "nightly" the first time somebody typed it that way, and a plan whose
   * name was only ever suggested would rename itself on every run.
   *
   * Its slug, because run history is read under it.
   *
   * On a create the slug comes from the NAME. Neither the id nor the slug is
   * ever derived from the config: two plans may hold one config and differ
   * only by name, so a config-derived key collides.
   */
  private async resolvePlanByName(params: {
    projectId: string;
    name: string;
    config: RunPlanConfigInput;
  }): Promise<{ suite: SimulationSuite; created: boolean }> {
    // Normalised before the plan is matched and before anything is stored, so
    // hand-picking every suite and pressing Run all reach one plan.
    const scope = await normalizePlanScope({
      projectId: params.projectId,
      scope: params.config.scope,
      prisma: this.prisma,
    });
    // A hand-picked scope carries its list on the plan, because the rule
    // itself names no scenario. Every other scope resolves at run time and
    // stores nothing.
    const scenarioIds =
      scope.mode === "cases" ? (params.config.scenarioIds ?? []) : [];
    const storedConfig = {
      scope: scope as unknown as Prisma.InputJsonValue,
      targets: sortSuiteTargets(params.config.targets),
      repeatCount: params.config.repeatCount ?? 1,
      simulatorModel: params.config.simulatorModel ?? null,
      judgeModel: params.config.judgeModel ?? null,
      scenarioIds,
    };

    const existing = await this.repository.findPlanByName({
      projectId: params.projectId,
      name: params.name,
    });
    if (existing) {
      const suite = await this.repository.update({
        id: existing.id,
        projectId: params.projectId,
        data: storedConfig,
      });
      return { suite, created: false };
    }

    const baseSlug = slugify(params.name) || "run-plan";
    const initialSlug = await this.generateUniqueSlug({
      baseSlug,
      projectId: params.projectId,
    });
    const suite = await this.saveWithSlugRetry({
      initialSlug,
      execute: (slug) =>
        this.repository.create({
          projectId: params.projectId,
          name: params.name,
          slug,
          kind: "custom",
          labels: [],
          ...storedConfig,
        }),
      regenerateSlug: () =>
        this.generateUniqueSlug({ baseSlug, projectId: params.projectId }),
    });
    return { suite, created: true };
  }

  /**
   * Resolve human-readable names for archived scenario and target IDs.
   * Used by the suite edit UI to show meaningful labels in warnings.
   */
  async resolveArchivedNames(params: {
    scenarioIds: string[];
    targets: SuiteTarget[];
    projectId: string;
    organizationId: string;
  }): Promise<{
    scenarios: Record<string, string>;
    targets: Record<string, string>;
  }> {
    const { scenarioIds, targets, projectId, organizationId } = params;

    const scenarioRows =
      scenarioIds.length > 0
        ? await this.scenarioRepository.findNamesByIds({
            ids: scenarioIds,
            projectId,
          })
        : [];
    const scenarios: Record<string, string> = Object.fromEntries(
      scenarioRows.map((r) => [r.id, r.name]),
    );

    const agentIds = targets
      .filter((t) => isSuiteAgentTargetType(t.type))
      .map((t) => t.referenceId);
    const promptIds = targets
      .filter((t) => t.type === "prompt")
      .map((t) => t.referenceId);

    const agentRows =
      agentIds.length > 0
        ? await this.agentRepository.findNamesByIds({
            ids: agentIds,
            projectId,
          })
        : [];

    const promptRows =
      promptIds.length > 0
        ? await this.llmConfigRepository.findNamesByIds({
            ids: promptIds,
            projectId,
            organizationId,
          })
        : [];

    const targetNames: Record<string, string> = {};
    for (const r of agentRows) targetNames[r.id] = r.name;
    for (const r of promptRows) targetNames[r.id] = r.name;

    return { scenarios, targets: targetNames };
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
      throw new SuiteNameTakenError();
    }
  }

  /**
   * Picks a slug not taken by any suite in the project, appending an
   * incrementing numeric suffix (-2, -3, ...) on collision. A TOCTOU race
   * between this check and the insert is closed by
   * {@link SuiteService.saveWithSlugRetry}.
   */
  private async generateUniqueSlug(params: {
    baseSlug: string;
    projectId: string;
  }): Promise<string> {
    return pickFreeSlug({
      baseSlug: params.baseSlug,
      takenSlugs: await this.repository.findSlugsByPrefix({
        projectId: params.projectId,
        slugPrefix: params.baseSlug,
      }),
    });
  }

  /**
   * Runs a suite insert with one slug-conflict retry: a P2002 on the unique
   * (projectId, slug) regenerates the slug and tries once more.
   */
  private async saveWithSlugRetry(params: {
    initialSlug: string;
    execute: (slug: string) => Promise<SimulationSuite>;
    regenerateSlug: () => Promise<string>;
  }): Promise<SimulationSuite> {
    try {
      return await params.execute(params.initialSlug);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const newSlug = await params.regenerateSlug();
        return await params.execute(newSlug);
      }
      throw error;
    }
  }

  private async resolveReferences(params: {
    scenarioIds: string[];
    projectId: string;
    organizationId: string;
    targets: SuiteTarget[];
  }): Promise<{
    activeScenarioIds: string[];
    scenarioNameMap: Map<string, string>;
    scenarioVersionMap: Map<string, number>;
    scenarioConfigs: ScenarioRunConfig[];
    activeTargets: SuiteTarget[];
    skippedArchived: SuiteRunResult["skippedArchived"];
  }> {
    const { scenarioIds, projectId, organizationId, targets } = params;

    const scenarioResolution = await this.resolveScenarioReferences({
      ids: scenarioIds,
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

    // One read for everything the scheduler needs off each scenario: the name
    // shown on the queued job row, and the parameters and text the run has to
    // resolve before it schedules anything.
    const scenarioConfigs = await this.scenarioRepository.findRunConfigByIds({
      ids: scenarioResolution.active,
      projectId,
    });
    const scenarioNameMap = new Map(
      scenarioConfigs.map((scenario) => [scenario.id, scenario.name]),
    );
    // The version each queued run is stamped with, from the same read as the
    // names, so the stamp is the state the run was scheduled from.
    const scenarioVersionMap = new Map(
      scenarioConfigs.map((scenario) => [scenario.id, scenario.version]),
    );

    return {
      activeScenarioIds: scenarioResolution.active,
      scenarioNameMap,
      scenarioVersionMap,
      scenarioConfigs,
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

    const rows = await this.scenarioRepository.findManyIncludingArchived({
      ids,
      projectId,
    });
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

    // Partition targets by type. Use a positive filter so that future SuiteTarget["type"] additions
    // must be explicitly handled here instead of silently routing into the agent path.
    const agentTargets = targets.filter((t) => isSuiteAgentTargetType(t.type));
    const promptTargets = targets.filter((t) => t.type === "prompt");

    // Batch agent targets (both HTTP and code agents live in the Agent table)
    const agentRows =
      agentTargets.length > 0
        ? await this.agentRepository.findManyIncludingArchived({
            ids: agentTargets.map((t) => t.referenceId),
            projectId,
          })
        : [];
    const agentMap = new Map(agentRows.map((r) => [r.id, r]));

    // Batch prompt targets
    const promptExistingIds =
      promptTargets.length > 0
        ? await this.llmConfigRepository.findExistingIds({
            ids: promptTargets.map((t) => t.referenceId),
            projectId,
            organizationId,
          })
        : new Set<string>();

    const active: SuiteTarget[] = [];
    const archived: SuiteTarget[] = [];
    const missing: SuiteTarget[] = [];

    for (const target of agentTargets) {
      const row = agentMap.get(target.referenceId);
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

    return { active, archived, missing };
  }
}
