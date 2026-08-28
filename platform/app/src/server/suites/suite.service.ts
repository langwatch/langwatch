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
import { ScenarioNotFoundError } from "../scenarios/errors";
import type { RunParameterValues } from "../scenarios/parameters";
import { resolveRunParameters } from "../scenarios/resolve-run-parameters";
import type { RunActor } from "../scenarios/run-actor";
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
import { derivePlanName } from "./plan-name";
import { withPlanNameLock } from "./plan-name-lock";
import { isDynamicScope, parseSuiteScope, type SuiteScope } from "./scope";
import { readScopeMembership, readScopeScenarioIds } from "./scope-membership";
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

/** What a run's scenario and target references resolved to. */
type ResolvedRunReferences = {
  activeScenarioIds: string[];
  scenarioNameMap: Map<string, string>;
  scenarioVersionMap: Map<string, number>;
  scenarioConfigs: ScenarioRunConfig[];
  activeTargets: SuiteTarget[];
  skippedArchived: SuiteRunResult["skippedArchived"];
};

/**
 * A run whose every refusal has already been decided, waiting only to be
 * scheduled against a plan row.
 */
type PreparedRun = {
  /** The scenarios the run covers, archived ones included. */
  scenarioIds: string[];
  /** The targets the run reaches, in stored order. */
  targets: SuiteTarget[];
  references: ResolvedRunReferences;
  parametersByScenarioId: Map<string, RunParameterValues>;
  secretParametersByScenarioId: Map<string, RunSecretCiphertext>;
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

/** The execution settings a run carries and a test suite never holds. */
const EXECUTION_FIELDS = [
  "targets",
  "repeatCount",
  "simulatorModel",
  "judgeModel",
] as const;

type ExecutionField = (typeof EXECUTION_FIELDS)[number];

/** The execution fields a request carries, in the order they are refused. */
function executionFieldsIn(
  source: Partial<Record<ExecutionField, unknown>>,
): ExecutionField[] {
  return EXECUTION_FIELDS.filter((field) => source[field] !== undefined);
}

/** One refusal naming every execution field the request carried. */
function refuseExecutionFields(params: {
  fields: ExecutionField[];
  message: string;
}): never {
  throw new ValidationError(params.message, {
    meta: {
      fieldErrors: Object.fromEntries(
        params.fields.map((field) => [field, [params.message]]),
      ),
    },
  });
}

const PLAN_EXECUTION_REFUSAL =
  "A run plan runs its stored configuration. Send a new configuration to run-plans/run.";

const TEST_SUITE_EXECUTION_REFUSAL =
  "A test suite holds what it collects, not how a run of it is executed. Send the targets, the repeat count and the models with the run.";

/**
 * What a test suite refuses in an update.
 *
 * A scope and a member list are both a second answer to what the suite
 * collects, which its own filing already decides: a scope is a rule over the
 * whole project, and a member list is derived from `Scenario.testSuiteId` by
 * reconcileTestSuiteMembership and nothing else, so a direct write here would
 * fork the two sides of that invariant.
 *
 * The execution settings are refused for the same reason one step along: they
 * say how a run is executed, the run plan a run resolves already holds them,
 * and a copy on the test suite row is a second answer with nothing saying which
 * one the next run reads.
 */
function assertTestSuiteUpdate(data: UpdateSuiteInput): void {
  if (data.scope !== undefined && data.scope !== null) {
    throw new SuiteScopeNotAllowedError();
  }
  if (data.scenarioIds !== undefined) {
    throw new ValidationError(
      "A test suite's scenarios are managed by filing scenarios into it",
      {
        meta: {
          fieldErrors: {
            scenarioIds: [
              "A test suite's scenarios are managed by filing scenarios into it",
            ],
          },
        },
      },
    );
  }
  const execution = executionFieldsIn(data);
  if (execution.length > 0) {
    refuseExecutionFields({
      fields: execution,
      message: TEST_SUITE_EXECUTION_REFUSAL,
    });
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
   * The scenarios a hand-picked scope covers. A `scenarios` scope names no
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
   * The default is deliberately "run_plan" only: every caller that predates
   * test suites, the v1 run plan list and the public suites endpoint, names no
   * kind, and must never see a test suite row (an empty test suite would render 0/0
   * there and refuse to run). A caller that wants test suites says so.
   */
  async getAll(params: {
    projectId: string;
    kinds?: SuiteKind[];
    /** Archived rows too, for a view that resolves the plan of an old run. */
    includeArchived?: boolean;
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
          kinds: params.kinds ?? ["run_plan"],
          ...(params.includeArchived !== undefined && {
            includeArchived: params.includeArchived,
          }),
        });
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  /**
   * Creates an empty test suite. Unlike a run plan, a test suite starts with
   * no scenarios and no targets: scenarios arrive through filing, targets
   * through the run dialog.
   *
   * Test suite and plan slugs share one per-project namespace, so a name another
   * suite already uses gets a numeric suffix instead of a refusal: a person
   * naming a test suite must not be blocked by a run plan they may not even see.
   */
  async createTestSuite(params: {
    projectId: string;
    name: string;
  }): Promise<SimulationSuite> {
    return tracer.withActiveSpan(
      "SuiteService.createTestSuite",
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
          throw new ValidationError("A test suite needs a name", {
            meta: { fieldErrors: { name: ["A test suite needs a name"] } },
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
              kind: "test_suite",
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

  async getAllTestSuites(params: {
    projectId: string;
  }): Promise<SimulationSuite[]> {
    return this.getAll({ projectId: params.projectId, kinds: ["test_suite"] });
  }

  /**
   * One test suite with the scenarios filed in it, named.
   *
   * The names come from the test suite's `scenarioIds`, which
   * reconcileTestSuiteMembership keeps as the test suite's active members, and the
   * order of that list is the order the detail view reads. Archived scenarios are
   * left out: an archived test suite keeps a snapshot for a later restore, and it
   * may name scenarios archived since.
   */
  async getTestSuiteDetail(params: {
    projectId: string;
    testSuiteId: string;
  }): Promise<SimulationSuite & { scenarios: { id: string; name: string }[] }> {
    return tracer.withActiveSpan(
      "SuiteService.getTestSuiteDetail",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.testSuiteId,
        },
      },
      async (span) => {
        const testSuite = await this.repository.findById({
          id: params.testSuiteId,
          projectId: params.projectId,
        });
        if (testSuite?.kind !== "test_suite") {
          throw new SuiteNotFoundError();
        }
        const rows =
          testSuite.scenarioIds.length > 0
            ? await this.scenarioRepository.findActiveNamesByIds({
                ids: testSuite.scenarioIds,
                projectId: params.projectId,
              })
            : [];
        const nameById = new Map(rows.map((row) => [row.id, row.name]));
        const scenarios = testSuite.scenarioIds.flatMap((id) => {
          const name = nameById.get(id);
          return name === undefined ? [] : [{ id, name }];
        });
        span.setAttribute("result.count", scenarios.length);
        return { ...testSuite, scenarios };
      },
    );
  }

  /**
   * Renames a test suite. The slug stays as it was: run history routes and the
   * test suite's internal run set are addressed through it, so a rename must not
   * break either.
   */
  async renameTestSuite(params: {
    projectId: string;
    testSuiteId: string;
    name: string;
  }): Promise<SimulationSuite> {
    return tracer.withActiveSpan(
      "SuiteService.renameTestSuite",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.testSuiteId,
        },
      },
      async () => {
        const name = params.name.trim();
        if (!name) {
          throw new ValidationError("A test suite needs a name", {
            meta: { fieldErrors: { name: ["A test suite needs a name"] } },
          });
        }
        const testSuite = await this.repository.findById({
          id: params.testSuiteId,
          projectId: params.projectId,
        });
        if (testSuite?.kind !== "test_suite") {
          throw new SuiteNotFoundError();
        }
        return await this.repository.update({
          id: params.testSuiteId,
          projectId: params.projectId,
          data: { name },
        });
      },
    );
  }

  /**
   * Archives a test suite and every scenario filed in it, in one transaction.
   *
   * Constraint: the test suite's scenarioIds is NOT recomputed here. The archived
   * test suite keeps the membership it had as a readable snapshot, which is what
   * a future restore needs. This is the one place the membership invariant is
   * deliberately suspended (see server/suites/test-suite-membership.ts).
   *
   * Idempotent: archiving an archived test suite keeps its original archive time
   * and touches no scenario.
   */
  async archiveTestSuite(params: {
    projectId: string;
    testSuiteId: string;
  }): Promise<SimulationSuite> {
    return tracer.withActiveSpan(
      "SuiteService.archiveTestSuite",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "suite.id": params.testSuiteId,
        },
      },
      async () => {
        return await this.prisma.$transaction(async (tx) => {
          const testSuite = await tx.simulationSuite.findFirst({
            where: {
              id: params.testSuiteId,
              projectId: params.projectId,
              kind: "test_suite",
            },
            select: { id: true },
          });
          if (!testSuite) {
            throw new SuiteNotFoundError();
          }
          await this.scenarioRepository.archiveManyByTestSuite({
            projectId: params.projectId,
            testSuiteId: params.testSuiteId,
            tx,
          });
          const archived = await this.repository.archive({
            id: params.testSuiteId,
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
        if (existing.kind === "test_suite") {
          assertTestSuiteUpdate(data);
          // A test suite rename keeps its slug (see renameTestSuite), so no re-slug.
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
   * Schedule a run of a suite addressed by its stored row.
   *
   * What the row means depends on its kind, and the two are opposites:
   *
   * - a FOLDER holds no execution settings at all, so the request carries
   *   them and the run goes through {@link runTestSuite}, which resolves the
   *   run plan the settings are written onto;
   * - a CUSTOM row IS a run plan, so it runs the configuration it stores and
   *   a request that carries execution settings is refused. Replacing a
   *   plan's configuration is a run started under a name, through
   *   {@link runPlan}, never a side effect of running the plan.
   *
   * Resolves all scenario and target references, filtering out archived ones.
   * Schedules N active-scenarios x M active-targets x repeatCount jobs.
   *
   * @returns The batch run ID, job count, and any skipped archived references
   * @throws {ValidationError} if a custom row is run with execution settings
   * @throws {SuiteTargetsRequiredError} if a test suite is run with no target
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
    /**
     * The name of the run plan a test suite run resolves. Derived from the scope
     * and the targets when the caller sends none. Read by test suite runs only.
     */
    name?: string;
    /** The targets a test suite run goes against. */
    targets?: SuiteTarget[];
    /** How many times a test suite run repeats each pairing. */
    repeatCount?: number;
    /** Model overrides for a test suite run. */
    simulatorModel?: string | null;
    judgeModel?: string | null;
    /** Values supplied for the run, overriding each scenario's own defaults. */
    parameters?: RunParameterValues;
    /** One short line describing why this batch was run. */
    note?: string;
    /**
     * The person who started the run, stamped onto every run of the batch.
     * Absent when the caller named no person.
     *
     * @see specs/scenarios/run-actor-on-runs.feature
     */
    actor?: RunActor;
  }): Promise<SuiteRunResult> {
    if (params.suite.kind === "test_suite") {
      const { suite, ...rest } = params;
      return this.runTestSuite({
        ...rest,
        testSuiteId: suite.id,
        targets: params.targets ?? [],
      });
    }

    const overrides = executionFieldsIn(params);
    if (overrides.length > 0) {
      refuseExecutionFields({
        fields: overrides,
        message: PLAN_EXECUTION_REFUSAL,
      });
    }

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

        const prepared = await this.prepareRun({
          projectId,
          organizationId,
          targets,
          readScenarioIds: () => this.readRunMembership({ suite, projectId }),
          parameters: params.parameters,
        });

        const result = await this.scheduleRun({
          suite,
          projectId,
          prepared,
          idempotencyKey: params.idempotencyKey,
          batchRunId: params.batchRunId,
          note: params.note,
          actor: params.actor,
        });

        span.setAttribute("suite.batch_run_id", result.batchRunId);
        span.setAttribute("suite.job_count", result.jobCount);

        return result;
      },
    );
  }

  /**
   * Resolves everything a run needs, and refuses the run here when it cannot
   * start.
   *
   * Every refusal a run raises is decided in this one step, and the step reads
   * no run plan row of its own. That is what lets a caller which creates a
   * plan prepare the run first and write the plan only once the run holds up,
   * so a refused run leaves no plan behind and rewrites no plan's config.
   *
   * The scenarios arrive through a callback because reading them can also
   * write: a plan that already exists refreshes its cached list from the same
   * read. The targets are checked before that callback runs, so a suite with
   * no target at all is refused before anything is read or written.
   *
   * @throws {SuiteTargetsRequiredError} if the suite names no target
   * @throws {SuiteScopeEmptyError} if a dynamic scope covers no scenario
   * @throws {InvalidScenarioReferencesError} if any scenario references are missing (deleted)
   * @throws {InvalidTargetReferencesError} if any target references are missing (deleted)
   * @throws {AllScenariosArchivedError} if all scenarios are archived
   * @throws {AllTargetsArchivedError} if all targets are archived
   * @throws {ScenarioParameterUnknownError} if a supplied parameter name is
   *   declared by no scenario in the run
   * @throws {ScenarioParameterMissingError} if a scenario's text reads a
   *   parameter the run resolved no value for
   * @throws {ScenarioSecretParameterMissingError} if a declared secret has no
   *   value for this run
   * @throws {ScenarioParameterTemplateInvalidError} if a scenario that
   *   declares parameters has text that cannot be rendered
   */
  private async prepareRun(params: {
    projectId: string;
    organizationId: string;
    targets: SuiteTarget[];
    readScenarioIds: () => Promise<string[]>;
    parameters?: RunParameterValues;
  }): Promise<PreparedRun> {
    // A suite with no target at all, a test suite before its first run,
    // is refused before anything is resolved or scheduled.
    if (params.targets.length === 0) {
      throw new SuiteTargetsRequiredError();
    }

    const scenarioIds = await params.readScenarioIds();
    const references = await this.resolveReferences({
      scenarioIds,
      projectId: params.projectId,
      organizationId: params.organizationId,
      targets: params.targets,
    });

    const { parametersByScenarioId, secretParametersByScenarioId } =
      await resolveParameterMaps({
        scenarios: references.scenarioConfigs,
        values: params.parameters,
      });

    return {
      scenarioIds,
      targets: params.targets,
      references,
      parametersByScenarioId,
      secretParametersByScenarioId,
    };
  }

  /** Queues a prepared run against the plan row that holds it. */
  private async scheduleRun(params: {
    suite: SimulationSuite;
    projectId: string;
    prepared: PreparedRun;
    idempotencyKey: string;
    batchRunId?: string;
    note?: string;
    actor?: RunActor;
  }): Promise<SuiteRunResult> {
    const { suite, prepared } = params;
    return this.suiteRunService.startRun({
      suiteId: suite.id,
      projectId: params.projectId,
      activeScenarioIds: prepared.references.activeScenarioIds,
      scenarioNameMap: prepared.references.scenarioNameMap,
      scenarioVersionMap: prepared.references.scenarioVersionMap,
      activeTargets: prepared.references.activeTargets,
      repeatCount: suite.repeatCount,
      skippedArchived: prepared.references.skippedArchived,
      idempotencyKey: params.idempotencyKey,
      batchRunId: params.batchRunId,
      parametersByScenarioId: prepared.parametersByScenarioId,
      secretParametersByScenarioId: prepared.secretParametersByScenarioId,
      note: params.note,
      actor: params.actor,
      simulatorModel: suite.simulatorModel,
      judgeModel: suite.judgeModel,
    });
  }

  /**
   * The scenarios a run of a stored plan covers.
   *
   * A plan covers what its scope says. A dynamic scope is resolved against
   * the project as it is right now and written back onto the plan, so a scenario
   * written after the plan runs without the plan being edited. A plan with no
   * scope, or one of mode "scenarios", runs the scenarioIds it stores.
   *
   * @throws {SuiteScopeEmptyError} when a dynamic scope covers no scenario.
   */
  private async readRunMembership(params: {
    suite: SimulationSuite;
    projectId: string;
  }): Promise<string[]> {
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
   * preselects them. It is a kind "run_plan" suite, so v1 lists it as an
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
    actor?: RunActor;
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
                kind: "run_plan",
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
          actor: params.actor,
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
   * The run is resolved in full before the plan row is touched. Every check
   * that can refuse a run reads the config, never the row, so a refused run
   * creates no plan and leaves the config of the plan its name matches exactly
   * as it was.
   *
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  async runPlan(params: {
    projectId: string;
    organizationId: string;
    /**
     * The plan this run joins or creates. Derived from what the run covers
     * and what it runs against when the caller sends none, by the same rule
     * the run dialog suggests a name with.
     */
    name?: string;
    config: RunPlanConfigInput;
    idempotencyKey: string;
    batchRunId?: string;
    parameters?: RunParameterValues;
    note?: string;
    actor?: RunActor;
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
        const requestedName = params.name?.trim();
        if (params.name !== undefined && !requestedName) {
          throw new ValidationError("A run needs a name", {
            meta: { fieldErrors: { name: ["A run needs a name"] } },
          });
        }

        // Normalised before the plan is matched and before anything is
        // stored, so hand-picking every suite and pressing Run all reach one
        // plan.
        const scope = await normalizePlanScope({
          projectId: params.projectId,
          scope: params.config.scope,
          prisma: this.prisma,
        });
        const targets = sortSuiteTargets(params.config.targets);
        span.setAttribute("suite.target_count", targets.length);

        const prepared = await this.prepareRun({
          projectId: params.projectId,
          organizationId: params.organizationId,
          targets,
          readScenarioIds: () =>
            this.readPlanMembership({
              projectId: params.projectId,
              scope,
              scenarioIds: params.config.scenarioIds ?? [],
            }),
          parameters: params.parameters,
        });
        span.setAttribute("suite.scenario_count", prepared.scenarioIds.length);

        // Derived only once the run holds up, so a refused run reads no names
        // it will not use.
        const name =
          requestedName ??
          (await this.defaultPlanName({
            projectId: params.projectId,
            organizationId: params.organizationId,
            scope,
            scenarioIds: params.config.scenarioIds ?? [],
            targets,
          }));

        const { suite, created } = await this.resolvePlanByName({
          projectId: params.projectId,
          name,
          config: params.config,
          scope,
          targets,
          scenarioIds: prepared.scenarioIds,
        });
        span.setAttribute("suite.id", suite.id);
        span.setAttribute("suite.plan_created", created);

        const result = await this.scheduleRun({
          suite,
          projectId: params.projectId,
          prepared,
          idempotencyKey: params.idempotencyKey,
          batchRunId: params.batchRunId,
          note: params.note,
          actor: params.actor,
        });
        span.setAttribute("suite.batch_run_id", result.batchRunId);
        span.setAttribute("suite.job_count", result.jobCount);

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
   * Starts a run of one test suite, addressed by its id.
   *
   * A test suite holds what it collects and nothing about how a run of it is
   * executed, so the targets, the repeat count and the models arrive with the
   * request and are written onto the run plan this run resolves. A request
   * that names no target is refused before anything is read: there is no
   * stored row to fall back to, by design.
   *
   * @see specs/suites/test-suite-run-plan-reuse.feature
   */
  async runTestSuite(params: {
    projectId: string;
    organizationId: string;
    testSuiteId: string;
    targets: SuiteTarget[];
    /** Derived from the suite's name and the targets when absent. */
    name?: string;
    repeatCount?: number;
    simulatorModel?: string | null;
    judgeModel?: string | null;
    idempotencyKey: string;
    batchRunId?: string;
    parameters?: RunParameterValues;
    note?: string;
    actor?: RunActor;
  }): Promise<
    SuiteRunResult & { suiteId: string; planName: string; created: boolean }
  > {
    if (params.targets.length === 0) {
      throw new SuiteTargetsRequiredError();
    }
    const testSuite = await this.repository.findById({
      id: params.testSuiteId,
      projectId: params.projectId,
    });
    if (testSuite?.kind !== "test_suite") {
      throw new SuiteNotFoundError();
    }
    return this.runPlan({
      projectId: params.projectId,
      organizationId: params.organizationId,
      ...(params.name !== undefined && { name: params.name }),
      config: {
        scope: { mode: "test_suites", testSuiteIds: [params.testSuiteId] },
        targets: params.targets,
        ...(params.repeatCount !== undefined && {
          repeatCount: params.repeatCount,
        }),
        ...(params.simulatorModel !== undefined && {
          simulatorModel: params.simulatorModel,
        }),
        ...(params.judgeModel !== undefined && {
          judgeModel: params.judgeModel,
        }),
      },
      idempotencyKey: params.idempotencyKey,
      ...(params.batchRunId !== undefined && { batchRunId: params.batchRunId }),
      ...(params.parameters !== undefined && {
        parameters: params.parameters,
      }),
      ...(params.note !== undefined && { note: params.note }),
      ...(params.actor !== undefined && { actor: params.actor }),
    });
  }

  /**
   * Starts a run of one scenario, addressed by its id.
   *
   * The same path as a suite run, over a hand-picked scope of one scenario. The
   * scenario is checked first so an id that names nothing is refused as a missing
   * scenario rather than as a plan whose scope covers nothing.
   */
  async runScenario(params: {
    projectId: string;
    organizationId: string;
    scenarioId: string;
    targets: SuiteTarget[];
    /** Derived from the scenario's name and the targets when absent. */
    name?: string;
    repeatCount?: number;
    simulatorModel?: string | null;
    judgeModel?: string | null;
    idempotencyKey: string;
    batchRunId?: string;
    parameters?: RunParameterValues;
    note?: string;
    actor?: RunActor;
  }): Promise<
    SuiteRunResult & { suiteId: string; planName: string; created: boolean }
  > {
    const found = await this.scenarioRepository.findNamesByIds({
      ids: [params.scenarioId],
      projectId: params.projectId,
    });
    if (found.length === 0) {
      throw new ScenarioNotFoundError();
    }
    return this.runPlan({
      projectId: params.projectId,
      organizationId: params.organizationId,
      ...(params.name !== undefined && { name: params.name }),
      config: {
        scope: { mode: "scenarios" },
        scenarioIds: [params.scenarioId],
        targets: params.targets,
        ...(params.repeatCount !== undefined && {
          repeatCount: params.repeatCount,
        }),
        ...(params.simulatorModel !== undefined && {
          simulatorModel: params.simulatorModel,
        }),
        ...(params.judgeModel !== undefined && {
          judgeModel: params.judgeModel,
        }),
      },
      idempotencyKey: params.idempotencyKey,
      ...(params.batchRunId !== undefined && { batchRunId: params.batchRunId }),
      ...(params.parameters !== undefined && {
        parameters: params.parameters,
      }),
      ...(params.note !== undefined && { note: params.note }),
      ...(params.actor !== undefined && { actor: params.actor }),
    });
  }

  /**
   * The name a run takes when the caller sends none: what it covers, then
   * what it runs against.
   *
   * The words are the run dialog's, so a run started from the command line
   * and one started from the dialog over the same scope and targets resolve
   * to one plan.
   */
  private async defaultPlanName(params: {
    projectId: string;
    organizationId: string;
    scope: SuiteScope;
    /** The scenarios a hand-picked scope covers; read by that scope alone. */
    scenarioIds: string[];
    targets: SuiteTarget[];
  }): Promise<string> {
    const [scopeLabel, targetNames] = await Promise.all([
      this.scopeLabel({
        projectId: params.projectId,
        scope: params.scope,
        scenarioIds: params.scenarioIds,
      }),
      this.resolveTargetNames({
        targets: params.targets,
        projectId: params.projectId,
        organizationId: params.organizationId,
      }),
    ]);
    return derivePlanName({
      scopeLabel,
      // Stored order, so the name reads the columns in the order the results
      // show them. A target the project no longer names reads as its id.
      targetLabels: sortSuiteTargets(params.targets).map(
        (target) => targetNames[target.referenceId] ?? target.referenceId,
      ),
    });
  }

  /**
   * What a scope is called in a run name.
   *
   * Every empty rule reads as "All scenarios": a rule that names nothing
   * covers everything the moment it is resolved, so the name says so.
   */
  private async scopeLabel(params: {
    projectId: string;
    scope: SuiteScope;
    scenarioIds: string[];
  }): Promise<string> {
    const { scope } = params;
    switch (scope.mode) {
      case "all":
        return RUN_ALL_SUITE_NAME;
      case "labels":
        return scope.labels.length === 0
          ? RUN_ALL_SUITE_NAME
          : scope.labels.join(", ");
      case "test_suites":
        return this.testSuiteScopeLabel({
          projectId: params.projectId,
          testSuiteIds: scope.testSuiteIds,
        });
      case "scenarios":
        return this.caseScopeLabel({
          projectId: params.projectId,
          scenarioIds: params.scenarioIds,
        });
    }
  }

  /**
   * One or two test suites read by name, more read as a count: a name listing
   * five suites is no longer a name.
   */
  private async testSuiteScopeLabel(params: {
    projectId: string;
    testSuiteIds: string[];
  }): Promise<string> {
    if (params.testSuiteIds.length === 0) return RUN_ALL_SUITE_NAME;
    if (params.testSuiteIds.length > 2) {
      return `${params.testSuiteIds.length} test suites`;
    }
    const rows = await this.repository.findNamesByIds({
      ids: params.testSuiteIds,
      projectId: params.projectId,
    });
    const nameById = new Map(rows.map((row) => [row.id, row.name]));
    const names = params.testSuiteIds.flatMap((id) => {
      const name = nameById.get(id);
      return name === undefined ? [] : [name];
    });
    return names.length === 0 ? RUN_ALL_SUITE_NAME : names.join(", ");
  }

  /**
   * One hand-picked scenario reads by its own name, several as a count.
   *
   * A count in place of the one name would name every single-scenario run of one
   * agent the same thing, and they would all stack onto one run plan.
   */
  private async caseScopeLabel(params: {
    projectId: string;
    scenarioIds: string[];
  }): Promise<string> {
    if (params.scenarioIds.length === 0) return RUN_ALL_SUITE_NAME;
    if (params.scenarioIds.length > 1) {
      return `${params.scenarioIds.length} scenarios`;
    }
    const rows = await this.scenarioRepository.findNamesByIds({
      ids: params.scenarioIds,
      projectId: params.projectId,
    });
    return rows[0]?.name ?? "Selected scenario";
  }

  /**
   * The scenarios a run started under a NAME covers, read from the config
   * instead of from a plan row.
   *
   * A hand-picked scope runs the list the caller sent. Every other scope is a
   * rule over the project and is resolved against it now, so the run covers
   * the scenarios of this moment. What comes back is also what the plan is written
   * with, which is how the plan reads back with the scenarios its run covered.
   *
   * @throws {SuiteScopeEmptyError} when a dynamic scope covers no scenario.
   */
  private async readPlanMembership(params: {
    projectId: string;
    scope: SuiteScope;
    scenarioIds: string[];
  }): Promise<string[]> {
    if (!isDynamicScope(params.scope)) {
      return params.scenarioIds;
    }
    const resolved = await readScopeScenarioIds({
      projectId: params.projectId,
      scope: params.scope,
      tx: this.prisma,
    });
    if (resolved.length === 0) {
      throw new SuiteScopeEmptyError();
    }
    return resolved;
  }

  /**
   * The plan a name resolves to, matched or created, holding the given config.
   *
   * On a match ONLY the config is replaced. The plan keeps its own name and
   * its own slug.
   *
   * Its name, because a name is what a plan is: the match is made trimmed and
   * without scenario, so writing the caller's spelling back would rename "Nightly"
   * to "nightly" the first time somebody typed it that way, and a plan whose
   * name was only ever suggested would rename itself on every run.
   *
   * Its slug, because run history is read under it.
   *
   * On a create the slug comes from the NAME. Neither the id nor the slug is
   * ever derived from the config: two plans may hold one config and differ
   * only by name, so a config-derived key collides.
   *
   * This is the first write of the whole run, and it happens only once the run
   * itself holds up. The caller passes the normalised scope, the sorted
   * targets and the scenarios the run resolved, so nothing here can refuse the
   * run and nothing is resolved twice.
   *
   * The match and the write it decides are one step, under
   * {@link withPlanNameLock}. Runs of a name no plan holds yet arrive
   * together, so without it two of them both read "nothing here" and both
   * insert, and one name ends up naming two plans.
   */
  private async resolvePlanByName(params: {
    projectId: string;
    name: string;
    config: RunPlanConfigInput;
    /** The scope reduced to the one form the project agrees on. */
    scope: SuiteScope;
    /** The config's targets in stored order. */
    targets: SuiteTarget[];
    /** The scenarios the run covers, which the plan reads back as its own. */
    scenarioIds: string[];
  }): Promise<{ suite: SimulationSuite; created: boolean }> {
    const storedConfig = {
      scope: params.scope as unknown as Prisma.InputJsonValue,
      targets: params.targets,
      repeatCount: params.config.repeatCount ?? 1,
      simulatorModel: params.config.simulatorModel ?? null,
      judgeModel: params.config.judgeModel ?? null,
      scenarioIds: params.scenarioIds,
    };

    const baseSlug = slugify(params.name) || "run-plan";

    const resolveUnderLock = () =>
      withPlanNameLock(
        {
          prisma: this.prisma,
          projectId: params.projectId,
          name: params.name,
        },
        async (tx) => {
          const existing = await this.repository.findPlanByName({
            projectId: params.projectId,
            name: params.name,
            tx,
          });
          if (existing) {
            const suite = await this.repository.update({
              id: existing.id,
              projectId: params.projectId,
              data: storedConfig,
              tx,
            });
            return { suite, created: false };
          }

          const slug = await this.generateUniqueSlug({
            baseSlug,
            projectId: params.projectId,
            tx,
          });
          const suite = await this.repository.create(
            {
              projectId: params.projectId,
              name: params.name,
              slug,
              kind: "run_plan",
              labels: [],
              ...storedConfig,
            },
            { tx },
          );
          return { suite, created: true };
        },
      );

    try {
      return await resolveUnderLock();
    } catch (error) {
      // The name lock holds two runs of ONE name apart, so a slug taken here
      // was taken by a plan of another name that slugifies the same way. A
      // failed statement aborts its transaction, so the retry is the whole
      // locked block, which picks a free slug on its second read.
      if (isUniqueConstraintError(error)) {
        return await resolveUnderLock();
      }
      throw error;
    }
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

    const targetNames = await this.resolveTargetNames({
      targets,
      projectId,
      organizationId,
    });

    return { scenarios, targets: targetNames };
  }

  /**
   * What each target is called, by reference id.
   *
   * Agents and prompts live in different tables and are read in one batch
   * each. A reference the project no longer holds is simply absent, so the
   * caller decides what a removed target reads as.
   */
  private async resolveTargetNames(params: {
    targets: SuiteTarget[];
    projectId: string;
    organizationId: string;
  }): Promise<Record<string, string>> {
    const { targets, projectId, organizationId } = params;

    const agentIds = targets
      .filter((t) => isSuiteAgentTargetType(t.type))
      .map((t) => t.referenceId);
    const promptIds = targets
      .filter((t) => t.type === "prompt")
      .map((t) => t.referenceId);

    const [agentRows, promptRows] = await Promise.all([
      agentIds.length > 0
        ? this.agentRepository.findNamesByIds({ ids: agentIds, projectId })
        : Promise.resolve([]),
      promptIds.length > 0
        ? this.llmConfigRepository.findNamesByIds({
            ids: promptIds,
            projectId,
            organizationId,
          })
        : Promise.resolve([]),
    ]);

    const names: Record<string, string> = {};
    for (const row of agentRows) names[row.id] = row.name;
    for (const row of promptRows) names[row.id] = row.name;
    return names;
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
    tx?: Prisma.TransactionClient;
  }): Promise<string> {
    return pickFreeSlug({
      baseSlug: params.baseSlug,
      takenSlugs: await this.repository.findSlugsByPrefix({
        projectId: params.projectId,
        slugPrefix: params.baseSlug,
        tx: params.tx,
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
  }): Promise<ResolvedRunReferences> {
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
