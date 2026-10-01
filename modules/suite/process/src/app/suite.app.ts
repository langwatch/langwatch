import { AgentApi, type AgentApi as AgentApiType } from "@langwatch/agent-contract";
/**
 * The suite feature's application: what both of its doors call.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  EvaluatorApi,
  type EvaluatorApi as EvaluatorApiType,
  type EvaluatorWithFields,
} from "@langwatch/evaluator-contract";
import {
  RepositoryFoldStore,
  type EventingCommands,
  type FoldProjectionStore,
  type RetentionPolicyResolver,
} from "@langwatch/eventing";
import {
  FeatureFlagApi,
  type FeatureFlagApi as FeatureFlagApiType,
} from "@langwatch/feature-flag-contract";
import { ValidationError } from "@langwatch/handled-error";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi, type ProjectApi as ProjectApiType } from "@langwatch/project-contract";
import { PromptApi, type PromptApi as PromptApiType } from "@langwatch/prompt-contract";
import {
  ScenarioApi,
  ScenarioTestSuiteNotFoundError,
  type EvaluatorAttachment,
  type ScenarioApi as ScenarioApiType,
  type RunActor,
  type ScenarioRunConfig,
  type ScenarioTestSuite,
  type ScenarioTestSuiteCreateInput,
  type ScenarioTestSuiteIdInput,
  type ScenarioTestSuiteUpdateInput,
  type SimulationExternalSetSummary,
  type SimulationProjectDateRangeInput,
} from "@langwatch/scenario-contract";
import {
  SuiteApi,
  SuiteNotFoundError,
  SUITE_RUN_PROJECTION_VERSIONS,
  type SuiteRunParameters,
  type SuiteRunResult,
  type SuiteRunStateData,
  SuiteScopeNotAllowedError,
  type SuiteTarget,
  type CreateSuiteCommand,
  type CompleteSuiteRunItemCommandData,
  type ConnectedTargetAgent,
  type RecordSuiteRunItemStartedCommandData,
  type RegradeSuiteRunItemCommandData,
  type RunPlanWire,
  type StartSuiteRunCommandData,
  type Suite,
  type SuiteArchivedNamesInput,
  type SuiteIdInput,
  type SuiteRunAllInput,
  type SuiteRunAllResult,
  type SuiteRunInput,
  type SuiteRunPlanInput,
  type SuiteRunPlanResult,
  type UpdateSuiteCommand,
  OrganizationNotFoundForProjectError,
} from "@langwatch/suite-contract";
import type { Instant } from "@langwatch/time";
import type { Cluster, Redis } from "ioredis";

import {
  buildSuiteRunProcessingPipeline,
  type SuiteRunProcessingPipeline,
} from "../eventing/suite-run-processing.pipeline.ts";
import { ClickhouseSuiteEventingRepository } from "../repositories/clickhouse/clickhouse.suite-eventing.repository.ts";
import { RedisSuiteRunProcessingRepository } from "../repositories/redis/redis.suite-run-processing.repository.ts";
import type { SuiteRepositories } from "../repositories/suite.repositories.ts";
import { suitePlatformUrl } from "../rules/suite-platform-url.rules.ts";
import { AgentOwnerNamesService } from "../services/agent-owner-names.service.ts";
import {
  ConnectedTargetService,
  type ConnectedPresenceReader,
} from "../services/connected-target.service.ts";
import { RunPlanReadService } from "../services/run-plan-read.service.ts";
import { SuiteExecutionService } from "../services/suite-execution.service.ts";
import { SuitePlatformLinkService } from "../services/suite-platform-link.service.ts";
import { SuiteRunItemCommandsService } from "../services/suite-run-item-commands.service.ts";
import {
  SuiteRunModelsService,
  type SuiteRunModelsResolver,
} from "../services/suite-run-models.service.ts";
import { SuiteService } from "../services/suite.service.ts";

/**
 * What a lookup by id found. A test suite IS a suite of kind "test_suite", but the two
 * are stored and shaped differently, so the application says which it found
 * and each door renders it the way its own wire contract always has.
 */
export type SuiteOrTestSuite =
  | Readonly<{ kind: "suite"; suite: Suite }>
  | Readonly<{ kind: "test_suite"; testSuite: ScenarioTestSuite }>;

export interface SuiteAppDependencies {
  scenarios: ScenarioApiType;
  agents: AgentApiType;
  prompts: PromptApiType;
  projects: ProjectApiType;
  evaluators: EvaluatorApiType;
  featureFlags: FeatureFlagApiType;
}

/**
 * Shapes restated rather than imported from `@langwatch/process-stores`: a
 * module depends on contracts. `publicBaseUrl` is the process's own fact,
 * absent where the deployment named no `BASE_HOST`.
 */
type SuiteProcessMembers = Readonly<{
  clickhouse: ClickHouseQueryClient;
  publicBaseUrl: string | undefined;
  /** Absent in a deployment without Redis; the run fold reads the ClickHouse store uncached. */
  redis: Redis | Cluster | null;
}>;

/**
 * The run projection reads from ClickHouse only, so this module reads the
 * process's `clickhouse` member. A deployment naming none refuses at boot
 * naming this module and member, rather than serving an empty history from nothing.
 */
type SuiteSetup = FeatureSetup<
  typeof SuiteApp.dependencies,
  SuiteProcessMembers,
  undefined,
  SuiteRepositories
>;

/** What `SuiteApp` builds for itself, over its own reads and its peers. */
interface SuiteAppInfrastructure {
  execution: SuiteExecution;
  connectedPresence: ConnectedPresenceReader;
  publicBaseUrl: string | undefined;
}

export class SuiteApp implements SuiteApi {
  static readonly contract = SuiteApi;
  static readonly dependencies = {
    scenarios: ScenarioApi,
    agents: AgentApi,
    prompts: PromptApi,
    projects: ProjectApi,
    evaluators: EvaluatorApi,
    /** Owns `LANGWATCH_DEFAULT_RETENTION_DAYS`; a suite run is stamped with its default. */
    retention: DataRetentionApi,
    /** Decides which testing interface a run plan's platform link opens in. */
    featureFlags: FeatureFlagApi,
    /** The project's default model per role, stamped on each queued run as main did. */
    modelProviders: ModelProviderApi,
  };
  /** Every name is from the process's vocabulary; boot refuses by name. */
  static readonly reads = ["clickhouse", "publicBaseUrl", "redis"] as const;

  static create(setup: SuiteSetup): SuiteApp {
    const { members, dependencies, repositories } = setup;
    const runItems = SuiteRunItemCommandsService.create();
    const infrastructure = SuiteApp.infrastructureOver({
      agents: dependencies.agents,
      scenarios: dependencies.scenarios,
      commands: runItems,
      resolveRunModels: SuiteRunModelsService.create({
        scenarios: dependencies.scenarios,
        modelProviders: dependencies.modelProviders,
      }).resolve,
      publicBaseUrl: members.publicBaseUrl,
    });
    const defaultRetentionDays = () => dependencies.retention.getPlatformDefaultRetentionDays();

    const suites = SuiteService.create({
      repository: repositories.suites,
      scenarios: dependencies.scenarios,
      agents: dependencies.agents,
      prompts: dependencies.prompts,
      evaluators: dependencies.evaluators,
      execution: infrastructure.execution,
      connectedPresence: infrastructure.connectedPresence,
    });

    return new SuiteApp({
      ...dependencies,
      suites,
      runItems,
      runPlans: SuiteApp.buildRunPlans({
        repositories,
        dependencies,
        publicBaseUrl: infrastructure.publicBaseUrl,
      }),
      publicBaseUrl: infrastructure.publicBaseUrl,
      pipeline: SuiteApp.buildEventingPipeline({
        clickhouse: members.clickhouse,
        redis: members.redis,
        defaultRetentionDays,
        retention: {
          resolve: (tenantId) =>
            dependencies.retention.getResolvedForProject({ projectId: tenantId }),
        },
      }),
    });
  }

  /**
   * `suite_run_processing` (ADR-144), ported from the deleted
   * `SuiteWorkerFeatureInstaller`: the fold caches through Redis where this
   * deployment has one, and reads the ClickHouse store uncached otherwise.
   */
  private static buildEventingPipeline(options: {
    clickhouse: ClickHouseQueryClient;
    redis: Redis | Cluster | null;
    defaultRetentionDays: () => number;
    retention: RetentionPolicyResolver;
  }) {
    const suiteRunStateFoldStore: FoldProjectionStore<SuiteRunStateData> = options.redis
      ? RedisSuiteRunProcessingRepository.create({
          clickhouse: options.clickhouse,
          defaultRetentionDays: options.defaultRetentionDays,
          redis: options.redis,
        }).buildRunStateFoldStore()
      : new RepositoryFoldStore(
          ClickhouseSuiteEventingRepository.create({
            clickhouse: options.clickhouse,
            defaultRetentionDays: options.defaultRetentionDays,
          }).build().suiteRunState,
          SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
        );

    return buildSuiteRunProcessingPipeline({
      suiteRunStateFoldStore,
      retention: options.retention,
    });
  }

  private static buildRunPlans(input: {
    repositories: SuiteRepositories;
    dependencies: Pick<SuiteAppDependencies, "featureFlags" | "projects">;
    publicBaseUrl: string | undefined;
  }): RunPlanReadService {
    return RunPlanReadService.create({
      repository: input.repositories.suites,
      links: SuitePlatformLinkService.create({
        featureFlags: input.dependencies.featureFlags,
        projects: input.dependencies.projects,
        publicBaseUrl: input.publicBaseUrl,
      }),
    });
  }

  /**
   * A run starts on `suite_run_processing` and each of its scenario runs is
   * queued by the scenario owner. The agent directory answers presence directly.
   */
  private static infrastructureOver(input: {
    agents: Pick<AgentApiType, "getPresence">;
    scenarios: Pick<ScenarioApiType, "resolveRunParametersForScenarios" | "queueSimulationRun">;
    commands: SuiteRunCommands;
    resolveRunModels?: SuiteRunModelsResolver;
    publicBaseUrl: string | undefined;
  }): SuiteAppInfrastructure {
    return {
      execution: SuiteExecutionService.create({
        commands: input.commands,
        scenarios: input.scenarios,
        ...(input.resolveRunModels ? { resolveRunModels: input.resolveRunModels } : {}),
      }),
      connectedPresence: (presenceInput) => input.agents.getPresence(presenceInput),
      publicBaseUrl: input.publicBaseUrl,
    };
  }

  // Test-only construction with overridable collaborators and in-memory run projection.
  static createForTesting(setup: {
    repositories: SuiteRepositories;
    dependencies: SuiteAppDependencies;
    infrastructure?: Partial<SuiteAppInfrastructure>;
    /** Deterministic ids and a fixed clock are the service's own seams, not infrastructure. */
    generateId?: () => string;
    now?: () => Instant;
  }): SuiteApp {
    const runItems = SuiteRunItemCommandsService.create();
    const defaults = SuiteApp.infrastructureOver({
      agents: setup.dependencies.agents,
      scenarios: setup.dependencies.scenarios,
      commands: runItems,
      publicBaseUrl: undefined,
    });
    const infrastructure = { ...defaults, ...setup.infrastructure };

    const suites = SuiteService.create({
      repository: setup.repositories.suites,
      scenarios: setup.dependencies.scenarios,
      agents: setup.dependencies.agents,
      prompts: setup.dependencies.prompts,
      evaluators: setup.dependencies.evaluators,
      execution: infrastructure.execution,
      connectedPresence: infrastructure.connectedPresence,
      ...(setup.generateId ? { generateId: setup.generateId } : {}),
      ...(setup.now ? { now: setup.now } : {}),
    });

    return new SuiteApp({
      ...setup.dependencies,
      suites,
      runItems,
      runPlans: SuiteApp.buildRunPlans({
        repositories: setup.repositories,
        dependencies: setup.dependencies,
        publicBaseUrl: infrastructure.publicBaseUrl,
      }),
      publicBaseUrl: infrastructure.publicBaseUrl,
    });
  }

  #dependencies: SuiteAppDependencies & { suites: SuiteService };
  readonly #publicBaseUrl: string | undefined;
  readonly #pipeline: SuiteRunProcessingPipeline | undefined;
  readonly #runItems: SuiteRunItemCommandsService;
  readonly #runPlans: RunPlanReadService;
  readonly #connectedTargets: ConnectedTargetService;

  private constructor(
    dependencies: SuiteAppDependencies & {
      suites: SuiteService;
      runItems: SuiteRunItemCommandsService;
      runPlans: RunPlanReadService;
      publicBaseUrl: string | undefined;
      pipeline?: SuiteRunProcessingPipeline;
    },
  ) {
    const { publicBaseUrl, pipeline, runItems, runPlans, ...rest } = dependencies;
    this.#publicBaseUrl = publicBaseUrl;
    this.#pipeline = pipeline;
    this.#runItems = runItems;
    this.#runPlans = runPlans;
    this.#dependencies = rest;
    this.#connectedTargets = ConnectedTargetService.create({
      agents: rest.agents,
      owners: AgentOwnerNamesService.create(rest.agents),
    });
  }

  /**
   * The pipeline `suite_run_processing` registers (ADR-144). Built once by
   * {@link create}; `createForTesting` builds no pipeline.
   */
  eventingPipeline(): SuiteRunProcessingPipeline {
    if (!this.#pipeline) {
      throw new Error("Suite was asked for its eventing pipeline, but none was built");
    }

    return this.#pipeline;
  }

  /** Binds `suite_run_processing`'s own senders; the run-item operations send through them. */
  connectCommands(commands: EventingCommands<SuiteRunProcessingPipeline>): void {
    this.#runItems.connect(commands);
  }

  // -- suite run items (main's suiteRunSync senders) --------------------------

  recordSuiteRunItemStarted(input: RecordSuiteRunItemStartedCommandData): Promise<void> {
    return this.#runItems.recordSuiteRunItemStarted(input);
  }

  completeSuiteRunItem(input: CompleteSuiteRunItemCommandData): Promise<void> {
    return this.#runItems.completeSuiteRunItem(input);
  }

  regradeSuiteRunItem(input: RegradeSuiteRunItemCommandData): Promise<void> {
    return this.#runItems.regradeSuiteRunItem(input);
  }

  getRunAttachments(input: {
    projectId: string;
    suiteId?: string | null;
    planId?: string | null;
  }): Promise<EvaluatorAttachment[]> {
    return this.#dependencies.suites.getRunAttachments(input);
  }

  getAttachedEvaluators(input: {
    projectId: string;
    attachments: readonly Pick<EvaluatorAttachment, "evaluatorId">[];
  }): Promise<Map<string, EvaluatorWithFields>> {
    return this.#dependencies.suites.getAttachedEvaluators(input);
  }

  assertConnectedAgentsRunnable(input: {
    agents: readonly ConnectedTargetAgent[];
    actor: RunActor | undefined;
  }): Promise<void> {
    return this.#connectedTargets.assertConnectedAgentsRunnable(input);
  }

  // -- reads -----------------------------------------------------------------

  /** The project's run plans. */
  list(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]> {
    return this.#dependencies.suites.list(input);
  }

  async listByIds(input: { projectId: string; ids: readonly string[] }): Promise<Suite[]> {
    const suites = await Promise.all(
      [...new Set(input.ids)].map((id) =>
        this.#dependencies.suites.findById({ projectId: input.projectId, id }),
      ),
    );

    return suites.filter((suite) => suite !== null);
  }

  /** The project's run plans as the run-plans family publishes them, linked for its interface. */
  listRunPlans(input: {
    projectId: string;
    projectSlug: string;
    includeArchived?: boolean;
  }): Promise<RunPlanWire[]> {
    return this.#runPlans.list(input);
  }

  /** One run plan as the run-plans family publishes it; a test suite id is not found. */
  getRunPlan(input: { projectId: string; projectSlug: string; id: string }): Promise<RunPlanWire> {
    return this.#runPlans.get(input);
  }

  /** The project's test-suite testSuites. */
  listTestSuites(input: {
    projectId: string;
    includeArchived?: boolean;
  }): Promise<ScenarioTestSuite[]> {
    return this.#dependencies.scenarios.listTestSuites(input);
  }

  /**
   * The active scenarios among the given ids, named, in the order given. An
   * archived scenario is left out — it holds no run history worth naming
   * here — and one the project no longer names is left out too.
   */
  async resolveActiveScenarioNames(input: {
    scenarioIds: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    if (input.scenarioIds.length === 0) return [];
    const states = await this.#dependencies.scenarios.getReferenceStates({
      ids: input.scenarioIds,
      projectId: input.projectId,
    });
    const activeIds = new Set(states.filter((state) => !state.archivedAt).map((state) => state.id));
    if (activeIds.size === 0) return [];
    const names = await this.#dependencies.scenarios.getNamesByIds({
      ids: [...activeIds],
      projectId: input.projectId,
    });
    const nameById = new Map(names.map((row) => [row.id, row.name]));
    return input.scenarioIds.flatMap((id) => {
      const name = nameById.get(id);
      return activeIds.has(id) && name !== undefined ? [{ id, name }] : [];
    });
  }

  /**
   * One suite by id, whichever kind it turns out to be.
   */
  async getByIdOrTestSuite(input: SuiteIdInput): Promise<SuiteOrTestSuite> {
    try {
      const suite = await this.#dependencies.suites.get(input);
      if (suite.kind !== "test_suite") return { kind: "suite", suite };
    } catch (error) {
      if (!(error instanceof SuiteNotFoundError)) throw error;
    }

    const testSuite = await this.#dependencies.scenarios.findTestSuite({
      testSuiteId: input.id,
      projectId: input.projectId,
    });
    if (!testSuite) throw new SuiteNotFoundError(input.id);
    return { kind: "test_suite", testSuite };
  }

  /** The names archived scenarios and targets had when a run referenced them. */
  async resolveArchivedNames(
    input: Omit<SuiteArchivedNamesInput, "organizationId">,
  ): Promise<{ scenarios: Record<string, string>; targets: Record<string, string> }> {
    const organizationId = await this.getOrganizationId(input.projectId);
    return this.#dependencies.suites.resolveArchivedNames({ ...input, organizationId });
  }

  /** The pass/fail counts the suite list renders, keyed by scenario set. */
  getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return this.#dependencies.scenarios.getInternalSuiteSummaries(input);
  }

  // -- writes ----------------------------------------------------------------

  /** A new run plan. */
  create(input: CreateSuiteCommand): Promise<Suite> {
    return this.#dependencies.suites.create(input);
  }

  /** A new, empty test-suite test suite. */
  createTestSuite(input: ScenarioTestSuiteCreateInput): Promise<ScenarioTestSuite> {
    return this.#dependencies.suites.createTestSuite(input);
  }

  /**
   * Updates one suite, whichever kind it turns out to be.
   */
  async update(input: UpdateSuiteCommand): Promise<SuiteOrTestSuite> {
    const testSuite = await this.#dependencies.scenarios.findTestSuite({
      testSuiteId: input.id,
      projectId: input.projectId,
    });
    if (!testSuite) {
      return { kind: "suite", suite: await this.#dependencies.suites.update(input) };
    }

    if (input.scope !== undefined) throw new SuiteScopeNotAllowedError();
    if (input.scenarioIds !== undefined) {
      throw new ValidationError(
        "A test suite's scenarios are managed by filing scenarios into it",
        {
          meta: {
            fieldErrors: {
              scenarioIds: ["A test suite's scenarios are managed by filing scenarios into it"],
            },
          },
        },
      );
    }

    refuseExecutionSettings(input);

    const updated = await this.#dependencies.suites.updateTestSuite({
      testSuiteId: input.id,
      projectId: input.projectId,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.labels === undefined ? {} : { labels: input.labels }),
      ...(input.fields === undefined ? {} : { fields: input.fields }),
      ...(input.evaluators === undefined ? {} : { evaluators: input.evaluators }),
    });
    return { kind: "test_suite", testSuite: updated };
  }

  /** Copies a run plan, leaving the source untouched. */
  duplicate(input: SuiteIdInput): Promise<Suite> {
    return this.#dependencies.suites.duplicate(input);
  }

  /** Archives a run plan. */
  archive(input: SuiteIdInput): Promise<Suite> {
    return this.#dependencies.suites.archive(input);
  }

  /** Archives a test suite, and every test case filed in it, in one transaction. */
  async archiveTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite> {
    try {
      return await this.#dependencies.scenarios.archiveTestSuite(input);
    } catch (error) {
      if (error instanceof ScenarioTestSuiteNotFoundError) {
        throw new SuiteNotFoundError(input.testSuiteId);
      }

      throw error;
    }
  }

  /** Renames a test suite. */
  async renameTestSuite(
    input: ScenarioTestSuiteIdInput & { name: string },
  ): Promise<ScenarioTestSuite> {
    try {
      return await this.#dependencies.scenarios.renameTestSuite(input);
    } catch (error) {
      if (error instanceof ScenarioTestSuiteNotFoundError) {
        throw new SuiteNotFoundError(input.testSuiteId);
      }

      throw error;
    }
  }

  /**
   * Edits what a test suite declares: its name, the fields it declares, the
   * evaluators attached to it. Send only what changes; the slug is kept, as
   * on a rename.
   */
  updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite> {
    return this.#dependencies.suites.updateTestSuite(input);
  }

  // -- runs ------------------------------------------------------------------

  /**
   * Schedules one suite's runs, resolving the project's organization first.
   */
  async run(input: Omit<SuiteRunInput, "organizationId">): Promise<SuiteRunResult> {
    const organizationId = await this.getOrganizationId(input.projectId);
    return this.#dependencies.suites.run({ ...input, organizationId });
  }

  /** Schedules every non-archived test case of the project. */
  async runAll(input: Omit<SuiteRunAllInput, "organizationId">): Promise<SuiteRunAllResult> {
    const organizationId = await this.getOrganizationId(input.projectId);
    return this.#dependencies.suites.runAll({ ...input, organizationId });
  }

  /**
   * Schedules a run under a NAME, resolving the project's organization first.
   *
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  async runPlan(input: Omit<SuiteRunPlanInput, "organizationId">): Promise<SuiteRunPlanResult> {
    const organizationId = await this.getOrganizationId(input.projectId);
    return this.#dependencies.suites.runPlan({ ...input, organizationId });
  }

  // -- the project a suite belongs to ---------------------------------------

  /**
   * The organization behind a project, refusing when there is none to resolve.
   */
  async getOrganizationId(projectId: string): Promise<string> {
    const organizationId = await this.#dependencies.projects.findOrganizationId(projectId);
    if (!organizationId) throw new OrganizationNotFoundForProjectError(projectId);

    return organizationId;
  }

  // -- the platform's own links ------------------------------------------

  /**
   * The platform's own address for one suite resource. A deployment that
   * serves these families but named no public origin refuses by name.
   */
  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The suite REST families were asked for a platform link, but this deployment named no public base URL",
      );
    }

    return suitePlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }
}

/**
 * A test suite holds what it collects, never how a run is executed: the targets,
 * repeat count and models travel with each run, onto the run plan. A request
 * carrying any is a caller mistake, so the refusal names every one it carried.
 */
const EXECUTION_FIELD_REFUSALS = {
  targets: "A test suite has no targets; they travel with each run",
  repeatCount: "A test suite has no repeat count; it travels with each run",
  simulatorModel: "A test suite has no simulator model; it travels with each run",
  judgeModel: "A test suite has no judge model; it travels with each run",
} as const;

function refuseExecutionSettings(input: UpdateSuiteCommand): void {
  const fieldErrors = Object.fromEntries(
    Object.entries(EXECUTION_FIELD_REFUSALS)
      .filter(([field]) => input[field as keyof typeof EXECUTION_FIELD_REFUSALS] !== undefined)
      .map(([field, refusal]) => [field, [refusal]]),
  );
  if (Object.keys(fieldErrors).length === 0) return;

  throw new ValidationError("A test suite holds no execution settings", {
    meta: { fieldErrors },
  });
}

/**
 * The application-specific boundary for turning a validated suite run into
 * durable events and queued work. Event sourcing remains application
 * composition; suite policy does not depend on its repositories.
 */
export interface SuiteExecution {
  execute(input: {
    suiteId: string;
    projectId: string;
    activeScenarioIds: string[];
    scenarioNames: Map<string, string>;
    scenarioVersions: Map<string, number>;
    scenarioConfigs: ScenarioRunConfig[];
    activeTargets: SuiteTarget[];
    repeatCount: number;
    skippedArchived: SuiteRunResult["skippedArchived"];
    idempotencyKey: string;
    batchRunId?: string;
    parameters?: SuiteRunParameters;
    note?: string;
    actor?: RunActor;
    /**
     * The simulation models the plan was configured with, stamped on every
     * run of the batch beside the models they resolved to.
     */
    simulatorModel?: string | null;
    judgeModel?: string | null;
  }): Promise<SuiteRunResult>;
}

/** The suite run's own start command; each scenario run is queued by the scenario owner. */
export interface SuiteRunCommands {
  startSuiteRun(data: StartSuiteRunCommandData): Promise<void>;
}
