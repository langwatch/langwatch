/**
 * The suite feature's application: what both of its doors call.
 */
import { HandledError, ValidationError } from "@langwatch/handled-error";
import { ProjectApi, type ProjectApi as ProjectApiType } from "@langwatch/project-contract";
import { AgentApi, type AgentApi as AgentApiType } from "@langwatch/agent-contract";
import { PromptApi, type PromptApi as PromptApiType } from "@langwatch/prompt-contract";
import { ScenarioApi, type ScenarioApi as ScenarioApiType } from "@langwatch/scenario-contract";
import type {
  ScenarioTestSuite,
  ScenarioTestSuiteCreateInput,
  ScenarioTestSuiteIdInput,
  SimulationExternalSetSummary,
  SimulationProjectDateRangeInput,
} from "@langwatch/scenario-contract";
import { SuiteApi, SuiteNotFoundError, SuiteRunParameters, SuiteRunResult, SuiteScopeNotAllowedError, SuiteTarget, type CreateSuiteCommand, type Suite, type SuiteArchivedNamesInput, type SuiteIdInput, type SuiteRunAllInput, type SuiteRunAllResult, type SuiteRunInput, type SuiteRunPlanInput, type SuiteRunPlanResult, type UpdateSuiteCommand } from "@langwatch/suite-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { SuiteExecution } from "./suite.app.ts";
import type { SuiteClickHouseClient } from "../repositories/clickhouse-client.repository.ts";
import { ClickHouseSuiteRunRepository } from "../repositories/clickhouse/clickhouse.suite-run.repository.ts";
import { MemorySuiteRunRepository } from "../repositories/memory/memory.suite-run.repository.ts";
import type { SuiteRepositories } from "../repositories/suite.repositories.ts";
import type { ConnectedPresenceReader } from "../services/connected-target.service.ts";
import { SuiteService } from "../services/suite.service.ts";
import type { Instant } from "@langwatch/time";

/**
 * The project exists but no organization can be resolved behind it.
 */
export class OrganizationNotFoundForProjectError extends HandledError {
  declare readonly code: "organization_not_found_for_project";

  constructor(projectId: string) {
    super("organization_not_found_for_project", "Organization not found for project", {
      httpStatus: 404,
      meta: { projectId },
    });
    this.name = "OrganizationNotFoundForProjectError";
  }
}

/**
 * What a lookup by id found. A test suite IS a suite of kind "test_suite", but the two
 * are stored and shaped differently, so the application says which it found
 * and each door renders it the way its own wire contract always has.
 */
export type SuiteOrTestSuite =
  | Readonly<{ kind: "suite"; suite: Suite }>
  | Readonly<{ kind: "test_suite"; testSuite: ScenarioTestSuite }>;

/** Technical ports supplied by the process root. Peer features arrive as API tokens. */
export interface SuiteAppInfrastructure {
  execution: SuiteExecution;
  connectedPresence?: ConnectedPresenceReader;
  resolveClickHouseClient: ((projectId: string) => Promise<SuiteClickHouseClient>) | null;
  defaultRetentionDays: number;
  generateId?: () => string;
  now?: () => Instant;
  suiteRunCommands: SuiteRunCommands;
  suiteRunId: SuiteRunId;
}

export interface SuiteAppDependencies {
  scenarios: ScenarioApiType;
  agents: AgentApiType;
  prompts: PromptApiType;
  projects: ProjectApiType;
}

type SuiteSetup = FeatureSetup<
  typeof SuiteApp.dependencies,
  SuiteAppInfrastructure,
  undefined,
  SuiteRepositories
>;

export class SuiteApp implements SuiteApi {
  static readonly contract = SuiteApi;
  static readonly dependencies = {
    scenarios: ScenarioApi,
    agents: AgentApi,
    prompts: PromptApi,
    projects: ProjectApi,
  };

  static create(setup: SuiteSetup): SuiteApp {
    const { members, dependencies, repositories } = setup;
    // The run projection is ClickHouse's, not this feature's persistence: a
    // process that composed no client folds into memory instead.
    const runRepository = members.resolveClickHouseClient
      ? ClickHouseSuiteRunRepository.create({
          resolveClient: members.resolveClickHouseClient,
          defaultRetentionDays: members.defaultRetentionDays,
        })
      : MemorySuiteRunRepository.create();

    const suites = SuiteService.create({
      repository: repositories.suites,
      runRepository,
      scenarios: dependencies.scenarios,
      agents: dependencies.agents,
      prompts: dependencies.prompts,
      execution: members.execution,
      ...(members.connectedPresence
        ? { connectedPresence: members.connectedPresence }
        : {}),
      generateId: members.generateId,
      now: members.now,
    });

    return new SuiteApp({ ...dependencies, suites });
  }

  #dependencies: SuiteAppDependencies & { suites: SuiteService };

  private constructor(dependencies: SuiteAppDependencies & { suites: SuiteService }) {
    this.#dependencies = dependencies;
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
    return this.#dependencies.scenarios.createTestSuite(input);
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

    const updated = await this.#dependencies.scenarios.updateTestSuite({
      testSuiteId: input.id,
      projectId: input.projectId,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.labels === undefined ? {} : { labels: input.labels }),
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
  archiveTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite> {
    return this.#dependencies.scenarios.archiveTestSuite(input);
  }

  /** Renames a test suite. */
  renameTestSuite(input: ScenarioTestSuiteIdInput & { name: string }): Promise<ScenarioTestSuite> {
    return this.#dependencies.scenarios.renameTestSuite(input);
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
    const organizationId = await this.#dependencies.projects.tryGetOrganizationId(projectId);
    if (!organizationId) throw new OrganizationNotFoundForProjectError(projectId);

    return organizationId;
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

export type QueueSimulationRunCommandData = {
  tenantId: string;
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  scenarioSetId: string;
  name?: string;
  metadata?: Record<string, unknown>;
  secretParameters?: Record<string, string>;
  target?: {
    type: "prompt" | "http" | "code" | "workflow" | "connected";
    referenceId: string;
  };
  occurredAt: number;
};

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

/** Durable Eventing commands supplied by the process composition root. */
export interface SuiteRunCommands {
  startSuiteRun(data: StartSuiteRunCommandData): Promise<void>;

  queueSimulationRun(data: QueueSimulationRunCommandData): Promise<void>;
}


export interface SuiteRunId {
  next(): string;
}
