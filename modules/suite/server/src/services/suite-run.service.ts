/**
 * Running a suite: resolving its scope to scenarios and targets, and handing the resolved run
 * to the execution port. The suite's own CRUD stays on `SuiteService`, which composes this one.
 */
import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  declaredDefaults,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  isDynamicScope,
  parseSuiteScope,
  RUN_ALL_SUITE_LABEL,
  RUN_ALL_SUITE_NAME,
  suiteBatchHistoryInputSchema,
  suiteRunAllInputSchema,
  suiteRunInputSchema,
  suiteRunPlanInputSchema,
  suiteRunStateInputSchema,
  sortSuiteTargets,
  SuiteScopeEmptyError,
  SuiteTargetsRequiredError,
  withCanonicalOverrides,
  type Suite,
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
} from "@langwatch/suite-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  parseScenarioParameterDefinitions,
  type ScenarioTestSuite,
} from "@langwatch/scenario-contract";
import { ConnectedTargetService } from "./connected-target.service.ts";
import type { SuiteExecution } from "../app/suite.app.ts";
import type { SuiteServiceOptions } from "./suite.service.ts";
import {
  defaultSuiteId,
  suiteSlugOf,
  TARGET_SECRET_REFUSAL,
  targetsOverrideASecret,
} from "../rules/suite-target.rules.ts";
import { SuiteRunScopeService } from "./suite-run-scope.service.ts";

type SuiteRunServiceOptions = {
  options: SuiteServiceOptions;
  /** The owning service's own read, so a run refuses a missing suite the same way. */
  get: (input: SuiteIdInput) => Promise<Suite>;
  testSuiteToSuite: (testSuite: ScenarioTestSuite) => Suite;
};

export class SuiteRunService {
  static create(deps: SuiteRunServiceOptions): SuiteRunService {
    return new SuiteRunService(deps);
  }

  private readonly scope: SuiteRunScopeService;

  private constructor(private readonly deps: SuiteRunServiceOptions) {
    this.scope = SuiteRunScopeService.create(deps.options);
  }

  private get options(): SuiteServiceOptions {
    return this.deps.options;
  }

  private get runRepository(): SuiteServiceOptions["runRepository"] {
    return this.deps.options.runRepository;
  }

  private get(input: SuiteIdInput): Promise<Suite> {
    return this.deps.get(input);
  }

  async run(input: SuiteRunInput): Promise<SuiteRunResult> {
    const parsed = suiteRunInputSchema.parse(input);
    const suite = await this.get({
      id: parsed.id,
      projectId: parsed.projectId,
    });
    const { scenarios } = this.options;
    if (suite.targets.length === 0) {
      throw new SuiteTargetsRequiredError();
    }

    const scope = parseSuiteScope(suite.scope);
    const scenarioIds = await this.scope.resolveRunMembership({
      suite,
      scopeIsDynamic: isDynamicScope(scope),
      projectId: parsed.projectId,
    });
    if (isDynamicScope(scope) && scenarioIds.length === 0) {
      throw new SuiteScopeEmptyError();
    }

    const { scenarioResolution, targetResolution } = await this.resolveRunReferences({
      scenarioIds,
      targets: suite.targets,
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
      actor: parsed.actor,
    });

    const scenarioConfigs = await scenarios.getRunConfigs({
      ids: scenarioResolution.active,
      projectId: parsed.projectId,
    });
    SuiteRunService.assertNoSecretOverrides({
      scenarios: scenarioConfigs,
      targets: targetResolution.active,
    });

    return this.execute({
      suite,
      parsed,
      scenarioResolution,
      targetResolution,
      scenarioConfigs,
      activeTargets: targetResolution.active,
    });
  }

  /**
   * Starts a run under a NAME, which is what identifies a run plan: the name either joins an
   * existing plan and replaces its config, or creates one.
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  async runPlan(input: SuiteRunPlanInput): Promise<SuiteRunPlanResult> {
    const parsed = suiteRunPlanInputSchema.parse(input);
    const { scenarios, repository } = this.options;

    if (parsed.config.targets.length === 0) {
      throw new SuiteTargetsRequiredError();
    }

    const { scope, scenarioIds } = await this.planScope(parsed);

    const { scenarioResolution, targetResolution, namedTargets } = await this.resolveRunReferences({
      scenarioIds,
      targets: parsed.config.targets,
      sortTargets: true,
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
      actor: parsed.actor,
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
    SuiteRunService.assertNoSecretOverrides({
      scenarios: scenarioConfigs,
      targets: parsed.config.targets,
    });

    const { targets, activeTargets } = this.canonicalPlanTargets({
      scenarioConfigs,
      namedTargets,
      activeTargets: targetResolution.active,
    });

    // Derived only once the run holds up, so a refused run reads no name it
    // will not use.
    const name =
      parsed.name ??
      (await this.scope.defaultPlanName({
        projectId: parsed.projectId,
        organizationId: parsed.organizationId,
        scope,
        scenarioIds,
        targets,
      }));

    const { suite, created } = await repository.findOrCreatePlanByName({
      id: (this.options.generateId ?? defaultSuiteId)(),
      projectId: parsed.projectId,
      name,
      scope,
      targets,
      scenarioIds,
      config: parsed.config,
    });

    const result = await this.execute({
      suite,
      parsed,
      scenarioResolution,
      targetResolution,
      scenarioConfigs,
      activeTargets,
    });

    return { ...result, suiteId: suite.id, planName: suite.name, created };
  }

  /**
   * Normalised before the plan is matched and before anything is stored, so Run all and
   * hand-picking every active test suite reach one plan.
   */
  private async planScope(
    parsed: SuiteRunPlanInput,
  ): Promise<{ scope: SuiteScope; scenarioIds: string[] }> {
    const scope = await this.scope.normalizeScope({
      projectId: parsed.projectId,
      scope: parsed.config.scope,
    });
    const scenarioIds = isDynamicScope(scope)
      ? await this.options.repository.resolveScopeMembership({
          projectId: parsed.projectId,
          scope,
        })
      : (parsed.config.scenarioIds ?? []);
    if (isDynamicScope(scope) && scenarioIds.length === 0) {
      throw new SuiteScopeEmptyError();
    }

    return { scope, scenarioIds };
  }

  /** Hands the resolved run to the execution port, with what the suite itself decides. */
  private execute({
    suite,
    parsed,
    scenarioResolution,
    targetResolution,
    scenarioConfigs,
    activeTargets,
  }: {
    suite: Pick<Suite, "id" | "repeatCount" | "simulatorModel" | "judgeModel">;
    parsed: Pick<
      SuiteRunInput,
      "projectId" | "idempotencyKey" | "batchRunId" | "parameters" | "note" | "actor"
    >;
    scenarioResolution: { active: string[]; archived: string[] };
    targetResolution: { archived: { referenceId: string }[] };
    scenarioConfigs: Parameters<SuiteExecution["execute"]>[0]["scenarioConfigs"];
    activeTargets: SuiteTarget[];
  }): Promise<SuiteRunResult> {
    return this.options.execution.execute({
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
  }

  /**
   * A value equal to a declared default is no override: the key, the sort, the name and the
   * stored targets all read the canonical set.
   */
  /**
   * Refuses a target whose overrides name a secret parameter, before the run
   * is scheduled and before a plan row is written.
   */
  private static assertNoSecretOverrides(input: {
    scenarios: readonly { parameters: unknown }[];
    targets: readonly SuiteTarget[];
  }): void {
    if (!targetsOverrideASecret(input)) {
      return;
    }

    throw new ValidationError(TARGET_SECRET_REFUSAL, {
      meta: { fieldErrors: { targets: [TARGET_SECRET_REFUSAL] } },
    });
  }

  private canonicalPlanTargets({
    scenarioConfigs,
    namedTargets,
    activeTargets,
  }: {
    scenarioConfigs: { parameters: unknown }[];
    namedTargets: SuiteTarget[];
    activeTargets: SuiteTarget[];
  }): { targets: SuiteTarget[]; activeTargets: SuiteTarget[] } {
    const defaults = declaredDefaults(
      scenarioConfigs.flatMap((scenario) => parseScenarioParameterDefinitions(scenario.parameters)),
    );

    return {
      targets: sortSuiteTargets(withCanonicalOverrides({ targets: namedTargets, defaults })),
      activeTargets: sortSuiteTargets(withCanonicalOverrides({ targets: activeTargets, defaults })),
    };
  }

  /**
   * The scenarios and targets a run actually covers, with every refusal raised before anything
   * is stored: a missing or fully archived reference, and a connected agent nobody may run.
   */
  private async resolveRunReferences({
    scenarioIds,
    targets,
    sortTargets = false,
    projectId,
    organizationId,
    actor,
  }: {
    scenarioIds: string[];
    targets: SuiteTarget[];
    sortTargets?: boolean;
    projectId: string;
    organizationId: string;
    actor: SuiteRunInput["actor"];
  }): Promise<{
    scenarioResolution: Awaited<ReturnType<SuiteRunScopeService["resolveScenarioReferences"]>>;
    targetResolution: Awaited<ReturnType<SuiteRunScopeService["resolveTargetReferences"]>>;
    namedTargets: SuiteTarget[];
  }> {
    const { scenarios, agents, prompts } = this.options;
    const scenarioResolution = await this.scope.resolveScenarioReferences({
      scenarioIds,
      projectId,
      scenarios,
    });
    if (scenarioResolution.missing.length > 0) {
      throw new InvalidScenarioReferencesError({ invalidIds: scenarioResolution.missing });
    }

    if (scenarioResolution.active.length === 0) {
      throw new AllScenariosArchivedError();
    }

    // A connected target may be named `<name>@<environment>`; from here on
    // every target names an id, so two spellings of one agent fold together.
    const namedTargets = await ConnectedTargetService.resolveConnectedReferences({
      targets,
      projectId,
      actor,
      agents,
      ...(this.options.connectedPresence ? { presence: this.options.connectedPresence } : {}),
    });
    const targetResolution = await this.scope.resolveTargetReferences({
      targets: sortTargets ? sortSuiteTargets(namedTargets) : namedTargets,
      projectId,
      organizationId,
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
      actor,
      owners: ConnectedTargetService.agentOwnerNameReader(agents),
    });

    return { scenarioResolution, targetResolution, namedTargets };
  }

  async runAll(input: SuiteRunAllInput): Promise<SuiteRunAllResult> {
    const parsed = suiteRunAllInputSchema.parse(input);
    const scenarioIds = (await this.options.scenarios.list({ projectId: parsed.projectId })).map(
      (scenario) => scenario.id,
    );
    const suite = await this.options.repository.saveManagedRunAll({
      id: (this.options.generateId ?? defaultSuiteId)(),
      projectId: parsed.projectId,
      name: RUN_ALL_SUITE_NAME,
      baseSlug: suiteSlugOf(RUN_ALL_SUITE_NAME),
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
}
