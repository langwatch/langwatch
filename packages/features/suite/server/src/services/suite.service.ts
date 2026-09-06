import type { ConnectedPresenceReader } from "./connected-target.service";
import {
  createSuiteCommandSchema,
  suiteArchivedNamesInputSchema,
  suiteIdInputSchema,
  suiteSchema,
  SuiteTestSuiteMembershipManagedError,
  SuiteNameTakenError,
  SuiteNotFoundError,
  SuiteScopeNotAllowedError,
  SuiteService as SuiteServiceContract,
  updateSuiteCommandSchema,
  type CreateSuiteCommand,
  type Suite,
  type SuiteArchivedNamesInput,
  type SuiteBatchHistoryInput,
  type SuiteIdInput,
  type SuiteRunAllInput,
  type SuiteRunAllResult,
  type SuiteRunInput,
  type SuiteRunResult,
  type SuiteRunPlanInput,
  type SuiteRunPlanResult,
  type SuiteRunStateData,
  type SuiteRunStateInput,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";
import type { AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import {
  jsonValueSchema,
  ScenarioTestSuiteNotFoundError,
  type ScenarioTestSuite,
  type ScenarioService,
} from "@langwatch/scenario-contract";
import type { SuiteExecutionPort } from "../ports/suite-execution.port";
import type { SuiteRepository } from "../repositories/suite.repository";
import type { SuiteRunReadRepository } from "../repositories/suite-run.repository";
import { SuiteRunService } from "./suite-run.service";
import { defaultSuiteId, isAgentTarget, suiteSlugOf } from "../rules/suite-target.rules";

const archivedSlugSuffix = "--archived";

export type SuiteServiceOptions = {
  repository: SuiteRepository;
  scenarios: ScenarioService;
  agents: AgentService;
  prompts: PromptService;
  execution: SuiteExecutionPort;
  runRepository: SuiteRunReadRepository;
  /**
   * Which connected agents have a process attached, so a target that names an
   * agent without an environment can be settled. Absent on a process that
   * composed no connected-agent runtime: every agent then reads as offline and
   * such a target is refused rather than guessed at.
   */
  connectedPresence?: ConnectedPresenceReader;
  generateId?: () => string;
  now?: () => Date;
};

export class SuiteService extends SuiteServiceContract {
  static create(options: SuiteServiceOptions): SuiteService {
    return new SuiteService(options);
  }

  private readonly runRepository: SuiteRunReadRepository;

  private readonly runs: SuiteRunService;

  private constructor(private readonly options: SuiteServiceOptions) {
    super();
    this.runRepository = options.runRepository;
    this.runs = SuiteRunService.create({
      options,
      get: (input) => this.get(input),
      testSuiteToSuite: (testSuite) => SuiteService.testSuiteToSuite(testSuite),
    });
  }

  list(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]> {
    return this.options.repository.list(input);
  }

  async get(input: SuiteIdInput): Promise<Suite> {
    const parsed = suiteIdInputSchema.parse(input);
    const suite = await this.tryGet(parsed);
    if (!suite) {
      throw new SuiteNotFoundError(parsed.id);
    }

    return suite;
  }

  async tryGet(input: SuiteIdInput): Promise<Suite | null> {
    const parsed = suiteIdInputSchema.parse(input);
    const suite = await this.options.repository.tryFindById(parsed);
    if (suite) {
      return suite;
    }

    const testSuite = await this.options.scenarios.tryGetTestSuite({
      testSuiteId: parsed.id,
      projectId: parsed.projectId,
    });

    return testSuite ? SuiteService.testSuiteToSuite(testSuite) : null;
  }

  async create(input: CreateSuiteCommand): Promise<Suite> {
    const parsed = createSuiteCommandSchema.parse(input);
    const slug = suiteSlugOf(parsed.name);
    await this.assertSlugAvailable({ projectId: parsed.projectId, slug });

    return this.options.repository.create({
      ...parsed,
      id: (this.options.generateId ?? defaultSuiteId)(),
      slug,
    });
  }

  async update(input: UpdateSuiteCommand): Promise<Suite> {
    const parsed = updateSuiteCommandSchema.parse(input);
    const existing = await this.get({ id: parsed.id, projectId: parsed.projectId });
    if (existing.kind === "test_suite") {
      if (parsed.scope !== void 0) {
        throw new SuiteScopeNotAllowedError();
      }

      if (parsed.scenarioIds !== void 0) {
        throw new SuiteTestSuiteMembershipManagedError();
      }

      return this.updateTestSuite(parsed);
    }

    const slug = parsed.name === undefined ? undefined : suiteSlugOf(parsed.name);
    if (slug !== undefined) {
      await this.assertSlugAvailable({
        projectId: parsed.projectId,
        slug,
        excludeId: parsed.id,
      });
    }

    return this.options.repository.update({
      ...parsed,
      ...(slug === undefined ? {} : { slug }),
    });
  }

  async duplicate(input: SuiteIdInput): Promise<Suite> {
    const source = await this.get(input);
    const name = `${source.name} (copy)`;
    const slug = suiteSlugOf(name);
    await this.assertSlugAvailable({ projectId: source.projectId, slug });

    return this.options.repository.create({
      projectId: source.projectId,
      name,
      description: source.description,
      scenarioIds: source.scenarioIds,
      ...(source.scope ? { scope: source.scope } : {}),
      targets: source.targets,
      repeatCount: source.repeatCount,
      labels: source.labels,
      simulatorModel: source.simulatorModel,
      judgeModel: source.judgeModel,
      id: (this.options.generateId ?? defaultSuiteId)(),
      slug,
    });
  }

  async archive(input: SuiteIdInput): Promise<Suite> {
    const suite = await this.get(input);
    if (suite.kind === "test_suite") {
      return this.archiveTestSuite(suite);
    }

    const archivedSlug = suite.slug.endsWith(archivedSlugSuffix)
      ? suite.slug
      : `${suite.slug}${archivedSlugSuffix}-${suite.id.slice(-6)}`;

    return this.options.repository.archive({
      ...suiteIdInputSchema.parse(input),
      archivedAt: (this.options.now ?? (() => new Date()))(),
      archivedSlug,
    });
  }

  async run(input: SuiteRunInput): Promise<SuiteRunResult> {
    return this.runs.run(input);
  }

  async runPlan(input: SuiteRunPlanInput): Promise<SuiteRunPlanResult> {
    return this.runs.runPlan(input);
  }

  async runAll(input: SuiteRunAllInput): Promise<SuiteRunAllResult> {
    return this.runs.runAll(input);
  }

  async tryGetSuiteRunState(input: SuiteRunStateInput): Promise<SuiteRunStateData | null> {
    return this.runs.tryGetSuiteRunState(input);
  }

  async getBatchHistory(input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]> {
    return this.runs.getBatchHistory(input);
  }

  async resolveArchivedNames(input: SuiteArchivedNamesInput): Promise<{
    scenarios: Record<string, string>;
    targets: Record<string, string>;
  }> {
    const parsed = suiteArchivedNamesInputSchema.parse(input);
    const { scenarios, agents, prompts } = this.options;
    const scenarioRows =
      parsed.scenarioIds.length === 0
        ? []
        : await scenarios.getNamesByIds({
            ids: parsed.scenarioIds,
            projectId: parsed.projectId,
          });
    const agentIds = parsed.targets
      .filter((target) => isAgentTarget(target))
      .map((target) => target.referenceId);
    const promptIds = parsed.targets
      .filter((target) => target.type === "prompt")
      .map((target) => target.referenceId);
    const [agentRows, promptRows] = await Promise.all([
      agentIds.length === 0
        ? []
        : agents.getNamesByIds({ ids: agentIds, projectId: parsed.projectId }),
      promptIds.length === 0
        ? []
        : prompts.getNamesByIds({
            ids: promptIds,
            projectId: parsed.projectId,
            organizationId: parsed.organizationId,
          }),
    ]);

    return {
      scenarios: Object.fromEntries(scenarioRows.map((row) => [row.id, row.name])),
      targets: Object.fromEntries([...agentRows, ...promptRows].map((row) => [row.id, row.name])),
    };
  }

  private async updateTestSuite(input: UpdateSuiteCommand): Promise<Suite> {
    try {
      const testSuite = await this.options.scenarios.updateTestSuite({
        testSuiteId: input.id,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        targets: input.targets?.map((target) => jsonValueSchema.parse(target)),
        repeatCount: input.repeatCount,
        labels: input.labels,
        simulatorModel: input.simulatorModel,
        judgeModel: input.judgeModel,
      });

      return SuiteService.testSuiteToSuite(testSuite);
    } catch (error) {
      if (error instanceof ScenarioTestSuiteNotFoundError) {
        throw new SuiteNotFoundError(input.id);
      }

      throw error;
    }
  }

  private async archiveTestSuite(suite: Suite): Promise<Suite> {
    try {
      const testSuite = await this.options.scenarios.archiveTestSuite({
        testSuiteId: suite.id,
        projectId: suite.projectId,
      });

      return SuiteService.testSuiteToSuite(testSuite);
    } catch (error) {
      if (error instanceof ScenarioTestSuiteNotFoundError) {
        throw new SuiteNotFoundError(suite.id);
      }

      throw error;
    }
  }

  private async assertSlugAvailable(input: {
    projectId: string;
    slug: string;
    excludeId?: string;
  }): Promise<void> {
    const existing = await this.options.repository.tryFindBySlug(input);
    if (existing && existing.id !== input.excludeId) {
      throw new SuiteNameTakenError(existing.name);
    }
  }

  private static testSuiteToSuite(testSuite: ScenarioTestSuite): Suite {
    return suiteSchema.parse(testSuite);
  }
}
