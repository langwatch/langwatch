import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  createSuiteCommandSchema,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  isDynamicScope,
  parseSuiteScope,
  RUN_ALL_SUITE_LABEL,
  RUN_ALL_SUITE_NAME,
  suiteArchivedNamesInputSchema,
  suiteBatchHistoryInputSchema,
  suiteIdInputSchema,
  suiteRunAllInputSchema,
  suiteRunInputSchema,
  suiteRunStateInputSchema,
  suiteSchema,
  SuiteTestSuiteMembershipManagedError,
  SuiteNameTakenError,
  SuiteNotFoundError,
  SuiteScopeEmptyError,
  SuiteScopeNotAllowedError,
  SuiteTargetsRequiredError,
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
  type SuiteRunStateData,
  type SuiteRunStateInput,
  type SuiteTarget,
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

const archivedSlugSuffix = "--archived";

export type SuiteServiceOptions = {
  repository: SuiteRepository;
  scenarios: ScenarioService;
  agents: AgentService;
  prompts: PromptService;
  execution: SuiteExecutionPort;
  runRepository: SuiteRunReadRepository;
  generateId?: () => string;
  now?: () => Date;
};

export class SuiteService extends SuiteServiceContract {
  static create(options: SuiteServiceOptions): SuiteService {
    return new SuiteService(options);
  }

  private readonly runRepository: SuiteRunReadRepository;

  private constructor(private readonly options: SuiteServiceOptions) {
    super();
    this.runRepository = options.runRepository;
  }

  list(input: { projectId: string }): Promise<Suite[]> {
    return this.options.repository.list(input);
  }

  async get(input: SuiteIdInput): Promise<Suite> {
    const parsed = suiteIdInputSchema.parse(input);
    const suite = await this.tryGet(parsed);
    if (!suite) throw new SuiteNotFoundError(parsed.id);
    return suite;
  }

  async tryGet(input: SuiteIdInput): Promise<Suite | null> {
    const parsed = suiteIdInputSchema.parse(input);
    const suite = await this.options.repository.tryFindById(parsed);
    if (suite) return suite;

    const testSuite = await this.options.scenarios.tryGetTestSuite({
      testSuiteId: parsed.id,
      projectId: parsed.projectId,
    });
    return testSuite ? SuiteService.testSuiteToSuite(testSuite) : null;
  }

  async create(input: CreateSuiteCommand): Promise<Suite> {
    const parsed = createSuiteCommandSchema.parse(input);
    const slug = SuiteService.slugify(parsed.name);
    await this.assertSlugAvailable({ projectId: parsed.projectId, slug });
    return this.options.repository.create({
      ...parsed,
      id: (this.options.generateId ?? SuiteService.defaultGenerateId)(),
      slug,
    });
  }

  async update(input: UpdateSuiteCommand): Promise<Suite> {
    const parsed = updateSuiteCommandSchema.parse(input);
    const existing = await this.get({ id: parsed.id, projectId: parsed.projectId });
    if (existing.kind === "test_suite") {
      if (parsed.scope !== void 0) throw new SuiteScopeNotAllowedError();
      if (parsed.scenarioIds !== void 0) throw new SuiteTestSuiteMembershipManagedError();

      return this.updateTestSuite(parsed);
    }

    const slug = parsed.name === undefined ? undefined : SuiteService.slugify(parsed.name);
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
    const slug = SuiteService.slugify(name);
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
      id: (this.options.generateId ?? SuiteService.defaultGenerateId)(),
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
    const parsed = suiteRunInputSchema.parse(input);
    const suite = await this.get({
      id: parsed.id,
      projectId: parsed.projectId,
    });
    const { scenarios, agents, prompts, execution } = this.options;
    if (suite.targets.length === 0) {
      throw new SuiteTargetsRequiredError();
    }

    const scope = parseSuiteScope(suite.scope);
    const scenarioIds = await this.resolveRunMembership({
      suite,
      scopeIsDynamic: isDynamicScope(scope),
      projectId: parsed.projectId,
    });
    if (isDynamicScope(scope) && scenarioIds.length === 0) {
      throw new SuiteScopeEmptyError();
    }

    const scenarioResolution = await this.resolveScenarioReferences({
      scenarioIds,
      projectId: parsed.projectId,
      scenarios,
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
      targets: suite.targets,
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
      agents,
      prompts,
    });
    if (targetResolution.missing.length > 0) {
      throw new InvalidTargetReferencesError({
        invalidIds: targetResolution.missing.map((target) => target.referenceId),
      });
    }
    if (targetResolution.active.length === 0) {
      throw new AllTargetsArchivedError();
    }

    const scenarioConfigs = await scenarios.getRunConfigs({
      ids: scenarioResolution.active,
      projectId: parsed.projectId,
    });
    return execution.execute({
      suiteId: suite.id,
      projectId: parsed.projectId,
      activeScenarioIds: scenarioResolution.active,
      scenarioNames: new Map(scenarioConfigs.map((scenario) => [scenario.id, scenario.name])),
      scenarioVersions: new Map(scenarioConfigs.map((scenario) => [scenario.id, scenario.version])),
      scenarioConfigs,
      activeTargets: targetResolution.active,
      repeatCount: suite.repeatCount,
      skippedArchived: {
        scenarios: scenarioResolution.archived,
        targets: targetResolution.archived.map((target) => target.referenceId),
      },
      idempotencyKey: parsed.idempotencyKey,
      batchRunId: parsed.batchRunId,
      parameters: parsed.parameters,
      note: parsed.note,
      actor: parsed.actor,
    });
  }

  async runAll(input: SuiteRunAllInput): Promise<SuiteRunAllResult> {
    const parsed = suiteRunAllInputSchema.parse(input);
    const scenarioIds = (await this.options.scenarios.list({ projectId: parsed.projectId })).map(
      (scenario) => scenario.id,
    );
    const suite = await this.options.repository.saveManagedRunAll({
      id: (this.options.generateId ?? SuiteService.defaultGenerateId)(),
      projectId: parsed.projectId,
      name: RUN_ALL_SUITE_NAME,
      baseSlug: SuiteService.slugify(RUN_ALL_SUITE_NAME),
      label: RUN_ALL_SUITE_LABEL,
      scenarioIds,
      targets: parsed.targets,
    });
    const result = await this.run({
      id: suite.id,
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
      idempotencyKey: parsed.idempotencyKey,
      batchRunId: parsed.batchRunId,
      parameters: parsed.parameters,
      note: parsed.note,
      actor: parsed.actor,
    });
    return { ...result, suiteId: suite.id };
  }

  async tryGetSuiteRunState(input: SuiteRunStateInput): Promise<SuiteRunStateData | null> {
    return this.runRepository.tryGetSuiteRunState(suiteRunStateInputSchema.parse(input));
  }

  async getBatchHistory(input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]> {
    return this.runRepository.getBatchHistory(suiteBatchHistoryInputSchema.parse(input));
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
      .filter((target) => SuiteService.isAgentTarget(target))
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

  private async resolveRunMembership(input: {
    suite: Suite;
    scopeIsDynamic: boolean;
    projectId: string;
  }): Promise<string[]> {
    if (input.suite.kind === "test_suite") {
      try {
        const definition = await this.options.scenarios.getTestSuiteRunDefinition({
          testSuiteId: input.suite.id,
          projectId: input.projectId,
        });
        return definition.scenarioIds;
      } catch (error) {
        if (error instanceof ScenarioTestSuiteNotFoundError) {
          throw new SuiteNotFoundError(input.suite.id);
        }
        throw error;
      }
    }
    if (!input.scopeIsDynamic) return input.suite.scenarioIds;

    return this.options.repository.resolveDynamicRunMembership({
      id: input.suite.id,
      projectId: input.projectId,
    });
  }

  private async assertSlugAvailable(input: {
    projectId: string;
    slug: string;
    excludeId?: string;
  }): Promise<void> {
    const existing = await this.options.repository.tryFindBySlug(input);
    if (existing && existing.id !== input.excludeId) throw new SuiteNameTakenError(existing.name);
  }

  private async resolveScenarioReferences(input: {
    scenarioIds: string[];
    projectId: string;
    scenarios: ScenarioService;
  }): Promise<{ active: string[]; archived: string[]; missing: string[] }> {
    const rows = await input.scenarios.getReferenceStates({
      ids: input.scenarioIds,
      projectId: input.projectId,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const active: string[] = [];
    const archived: string[] = [];
    const missing: string[] = [];
    for (const id of input.scenarioIds) {
      const scenario = byId.get(id);
      if (!scenario) missing.push(id);
      else if (scenario.archivedAt) archived.push(id);
      else active.push(id);
    }
    return { active, archived, missing };
  }

  private async resolveTargetReferences(input: {
    targets: SuiteTarget[];
    projectId: string;
    organizationId: string;
    agents: AgentService;
    prompts: PromptService;
  }): Promise<{
    active: SuiteTarget[];
    archived: SuiteTarget[];
    missing: SuiteTarget[];
  }> {
    const agentTargets = input.targets.filter((target) => SuiteService.isAgentTarget(target));
    const promptTargets = input.targets.filter((target) => target.type === "prompt");
    const [agentRows, promptIds] = await Promise.all([
      agentTargets.length === 0
        ? []
        : input.agents.getReferenceStates({
            ids: agentTargets.map((target) => target.referenceId),
            projectId: input.projectId,
          }),
      promptTargets.length === 0
        ? []
        : input.prompts.getExistingIds({
            ids: promptTargets.map((target) => target.referenceId),
            projectId: input.projectId,
            organizationId: input.organizationId,
          }),
    ]);
    const agentById = new Map(agentRows.map((row) => [row.id, row]));
    const existingPromptIds = new Set(promptIds);
    const active: SuiteTarget[] = [];
    const archived: SuiteTarget[] = [];
    const missing: SuiteTarget[] = [];
    for (const target of agentTargets) {
      const agent = agentById.get(target.referenceId);
      if (!agent) missing.push(target);
      else if (agent.archivedAt) archived.push(target);
      else active.push(target);
    }
    for (const target of promptTargets) {
      if (existingPromptIds.has(target.referenceId)) active.push(target);
      else missing.push(target);
    }
    return { active, archived, missing };
  }

  /** The id a suite gets when composition did not supply a minter. */
  private static defaultGenerateId(): string {
    return `suite_${crypto.randomUUID()}`;
  }

  private static slugify(value: string): string {
    return (
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "suite"
    );
  }

  private static isAgentTarget(target: SuiteTarget): boolean {
    switch (target.type) {
      case "http":
      case "code":
      case "workflow":
      // A connected target points at an Agent row like the other three. Its
      // reference id may also read `<name>@<environment>`, which the run
      // resolves to an agent id before membership is read.
      case "connected":
        return true;
      case "prompt":
        return false;
      default: {
        const unhandledType: never = target.type;
        throw new Error(`Unsupported suite target type: ${unhandledType}`);
      }
    }
  }

  private static testSuiteToSuite(testSuite: ScenarioTestSuite): Suite {
    return suiteSchema.parse(testSuite);
  }
}
