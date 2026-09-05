import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  createSuiteCommandSchema,
  declaredDefaults,
  derivePlanName,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  isDynamicScope,
  normalizePlanScope,
  parseSuiteScope,
  RUN_ALL_SUITE_LABEL,
  RUN_ALL_SUITE_NAME,
  suiteArchivedNamesInputSchema,
  suiteBatchHistoryInputSchema,
  suiteIdInputSchema,
  suiteRunAllInputSchema,
  suiteRunInputSchema,
  suiteRunPlanInputSchema,
  suiteRunStateInputSchema,
  suiteSchema,
  sortSuiteTargets,
  SuiteTestSuiteMembershipManagedError,
  SuiteNameTakenError,
  SuiteNotFoundError,
  SuiteScopeEmptyError,
  SuiteScopeNotAllowedError,
  SuiteTargetsRequiredError,
  SuiteService as SuiteServiceContract,
  targetLabels,
  updateSuiteCommandSchema,
  withCanonicalOverrides,
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
  type SuiteScope,
  type SuiteTarget,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";
import type { AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import {
  jsonValueSchema,
  parseScenarioParameterDefinitions,
  ScenarioTestSuiteNotFoundError,
  type ScenarioTestSuite,
  type ScenarioService,
} from "@langwatch/scenario-contract";
import type { SuiteExecutionPort } from "../ports/suite-execution.port";
import type { SuiteRepository } from "../repositories/suite.repository";
import type { SuiteRunReadRepository } from "../repositories/suite-run.repository";
import { ConnectedTargetService, type ConnectedTargetAgent } from "./connected-target.service";

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
      if (parsed.scope !== void 0) {
        throw new SuiteScopeNotAllowedError();
      }

      if (parsed.scenarioIds !== void 0) {
        throw new SuiteTestSuiteMembershipManagedError();
      }

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

    // A connected target may be named `<name>@<environment>`; from here on
    // every target names an id, so two spellings of one agent fold together.
    const namedTargets = await ConnectedTargetService.resolveConnectedReferences({
      targets: suite.targets,
      projectId: parsed.projectId,
      actor: parsed.actor,
      agents,
    });

    const targetResolution = await this.resolveTargetReferences({
      targets: namedTargets,
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

    await ConnectedTargetService.assertConnectedAgentsRunnable({
      agents: targetResolution.connectedAgents,
      actor: parsed.actor,
      owners: ConnectedTargetService.agentOwnerNameReader(agents),
    });

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
      simulatorModel: suite.simulatorModel,
      judgeModel: suite.judgeModel,
    });
  }

  /**
   * Starts a run under a NAME, which is what identifies a run plan: the name either joins an
   * existing plan and replaces its config, or creates one.
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  async runPlan(input: SuiteRunPlanInput): Promise<SuiteRunPlanResult> {
    const parsed = suiteRunPlanInputSchema.parse(input);
    const { scenarios, agents, prompts, execution, repository } = this.options;

    if (parsed.config.targets.length === 0) {
      throw new SuiteTargetsRequiredError();
    }

    // Normalised before the plan is matched and before anything is stored, so
    // hand-picking every active test suite and pressing Run all reach one plan.
    const scope = await this.normalizeScope({
      projectId: parsed.projectId,
      scope: parsed.config.scope,
    });
    const scenarioIds = isDynamicScope(scope)
      ? await repository.resolveScopeMembership({ projectId: parsed.projectId, scope })
      : (parsed.config.scenarioIds ?? []);
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

    // A connected target may be named `<name>@<environment>`; from here on
    // every target names an id, so two spellings of one agent fold together.
    const namedTargets = await ConnectedTargetService.resolveConnectedReferences({
      targets: parsed.config.targets,
      projectId: parsed.projectId,
      actor: parsed.actor,
      agents,
    });
    const targetResolution = await this.resolveTargetReferences({
      targets: sortSuiteTargets(namedTargets),
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

    await ConnectedTargetService.assertConnectedAgentsRunnable({
      agents: targetResolution.connectedAgents,
      actor: parsed.actor,
      owners: ConnectedTargetService.agentOwnerNameReader(agents),
    });

    const scenarioConfigs = await scenarios.getRunConfigs({
      ids: scenarioResolution.active,
      projectId: parsed.projectId,
    });
    // A refusal here (e.g. a missing secret) must throw before the plan row
    // is touched, matching `prepareRun` on main: nothing is written for a run
    // that will not hold up.
    await scenarios.resolveRunParametersForScenarios({
      scenarios: scenarioConfigs,
      values: parsed.parameters,
    });

    // A value equal to a declared default is no override: the key, the sort,
    // the name and the stored targets all read the canonical set.
    const defaults = declaredDefaults(
      scenarioConfigs.flatMap((scenario) => parseScenarioParameterDefinitions(scenario.parameters)),
    );
    const targets = sortSuiteTargets(withCanonicalOverrides({ targets: namedTargets, defaults }));
    const activeTargets = sortSuiteTargets(
      withCanonicalOverrides({ targets: targetResolution.active, defaults }),
    );

    // Derived only once the run holds up, so a refused run reads no name it
    // will not use.
    const name =
      parsed.name ??
      (await this.defaultPlanName({
        projectId: parsed.projectId,
        organizationId: parsed.organizationId,
        scope,
        scenarioIds,
        targets,
      }));

    const { suite, created } = await repository.findOrCreatePlanByName({
      id: (this.options.generateId ?? SuiteService.defaultGenerateId)(),
      projectId: parsed.projectId,
      name,
      scope,
      targets,
      scenarioIds,
      config: parsed.config,
    });

    const result = await execution.execute({
      suiteId: suite.id,
      projectId: parsed.projectId,
      activeScenarioIds: scenarioResolution.active,
      scenarioNames: new Map(scenarioConfigs.map((scenario) => [scenario.id, scenario.name])),
      scenarioVersions: new Map(scenarioConfigs.map((scenario) => [scenario.id, scenario.version])),
      scenarioConfigs,
      activeTargets,
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
      simulatorModel: suite.simulatorModel,
      judgeModel: suite.judgeModel,
    });

    return { ...result, suiteId: suite.id, planName: suite.name, created };
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

    if (!input.scopeIsDynamic) {
      return input.suite.scenarioIds;
    }

    return this.options.repository.resolveDynamicRunMembership({
      id: input.suite.id,
      projectId: input.projectId,
    });
  }

  /** Reads the project's active test suites only when the scope needs them. */
  private async normalizeScope(input: {
    projectId: string;
    scope: SuiteScope;
  }): Promise<SuiteScope> {
    if (input.scope.mode !== "test_suites") {
      return input.scope;
    }

    const testSuites = await this.options.scenarios.listTestSuites({
      projectId: input.projectId,
    });

    return normalizePlanScope({
      scope: input.scope,
      activeTestSuiteIds: testSuites.map((testSuite) => testSuite.id),
    });
  }

  /**
   * The name a run takes when its caller sends none: the scope, then the targets it goes
   * against — the same words the run dialog suggests, so a run started from the command line
   * and one started from the dialog over the same scope and targets land on one plan.
   */
  private async defaultPlanName(params: {
    projectId: string;
    organizationId: string;
    scope: SuiteScope;
    /** The scenarios a hand-picked scope covers; read by that scope alone. */
    scenarioIds: string[];
    targets: SuiteTarget[];
  }): Promise<string> {
    const [scopeLabel, names] = await Promise.all([
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
      targetLabels: targetLabels({
        targets: sortSuiteTargets(params.targets),
        nameOf: (target) => names.get(target.referenceId) ?? target.referenceId,
      }),
    });
  }

  /**
   * What a scope is called in a run name. Every empty rule reads as
   * {@link RUN_ALL_SUITE_NAME}: a rule that names nothing covers everything
   * the moment it is resolved, so the name says so.
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
        return scope.labels.length === 0 ? RUN_ALL_SUITE_NAME : scope.labels.join(", ");
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
   * One or two test suites read by name, more read as a count: a name
   * listing five suites is no longer a name.
   */
  private async testSuiteScopeLabel(params: {
    projectId: string;
    testSuiteIds: string[];
  }): Promise<string> {
    if (params.testSuiteIds.length === 0) {
      return RUN_ALL_SUITE_NAME;
    }

    if (params.testSuiteIds.length > 2) {
      return `${params.testSuiteIds.length} test suites`;
    }

    const named = new Set(params.testSuiteIds);
    const testSuites = await this.options.scenarios.listTestSuites({
      projectId: params.projectId,
    });
    const names = testSuites
      .filter((testSuite) => named.has(testSuite.id))
      .map((testSuite) => testSuite.name);

    return names.length === 0 ? RUN_ALL_SUITE_NAME : names.join(", ");
  }

  /**
   * One hand-picked scenario reads by its own name, several as a count: a
   * count in place of the one name would name every single-scenario run of
   * one agent the same thing, and they would all stack onto one run plan.
   */
  private async caseScopeLabel(params: {
    projectId: string;
    scenarioIds: string[];
  }): Promise<string> {
    if (params.scenarioIds.length === 0) {
      return RUN_ALL_SUITE_NAME;
    }

    if (params.scenarioIds.length > 1) {
      return `${params.scenarioIds.length} scenarios`;
    }

    const rows = await this.options.scenarios.getNamesByIds({
      ids: params.scenarioIds,
      projectId: params.projectId,
    });

    return rows[0]?.name ?? "Selected scenario";
  }

  /**
   * What each target is called, by reference id. A reference the project no
   * longer holds is simply absent, so the caller decides what a removed
   * target reads as.
   */
  private async resolveTargetNames(params: {
    targets: SuiteTarget[];
    projectId: string;
    organizationId: string;
  }): Promise<Map<string, string>> {
    const { targets, projectId, organizationId } = params;
    const agentIds = targets
      .filter((target) => SuiteService.isAgentTarget(target))
      .map((target) => target.referenceId);
    const promptIds = targets
      .filter((target) => target.type === "prompt")
      .map((target) => target.referenceId);

    const [agentRows, promptRows] = await Promise.all([
      agentIds.length === 0 ? [] : this.options.agents.getNamesByIds({ ids: agentIds, projectId }),
      promptIds.length === 0
        ? []
        : this.options.prompts.getNamesByIds({ ids: promptIds, projectId, organizationId }),
    ]);

    return new Map([...agentRows, ...promptRows].map((row) => [row.id, row.name]));
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
      if (!scenario) {
        missing.push(id);
      } else if (scenario.archivedAt) {
        archived.push(id);
      } else {
        active.push(id);
      }
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
    /** The active targets' own connected agents, for the ownership check. */
    connectedAgents: ConnectedTargetAgent[];
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
    const connectedAgents: ConnectedTargetAgent[] = [];
    for (const target of agentTargets) {
      const agent = agentById.get(target.referenceId);
      if (!agent) {
        missing.push(target);
      } else if (agent.archivedAt || ConnectedTargetService.isAgentUnseen(agent)) {
        archived.push(target);
      } else {
        active.push(target);
        if (agent.type === "connected") {
          connectedAgents.push({
            id: agent.id,
            name: agent.name ?? agent.id,
            type: agent.type,
            ownerUserId: agent.ownerUserId ?? null,
          });
        }
      }
    }

    for (const target of promptTargets) {
      if (existingPromptIds.has(target.referenceId)) {
        active.push(target);
      } else {
        missing.push(target);
      }
    }

    return { active, archived, missing, connectedAgents };
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
