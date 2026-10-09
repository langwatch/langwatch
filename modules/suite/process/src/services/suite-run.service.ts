import { ValidationError } from "@langwatch/handled-error";
import {
  parseScenarioParameterDefinitions,
  type EvaluatorAttachment,
  type ScenarioTestSuite,
} from "@langwatch/scenario-contract";
/**
 * Running a suite: resolving its scope to scenarios and targets, and handing the resolved run
 * to the execution port. The suite's own CRUD stays on `SuiteService`, which composes this one.
 */
import {
  declaredDefaults,
  isDynamicScope,
  parseSuiteScope,
  RUN_ALL_SUITE_LABEL,
  RUN_ALL_SUITE_NAME,
  suiteRunAllInputSchema,
  suiteRunInputSchema,
  suiteRunPlanInputSchema,
  sortSuiteTargets,
  SuiteScopeEmptyError,
  SuiteTargetsRequiredError,
  withCanonicalOverrides,
  type Suite,
  type SuiteIdInput,
  type SuiteRunAllInput,
  type SuiteRunAllResult,
  type SuiteRunInput,
  type SuiteRunResult,
  type SuiteRunPlanInput,
  type SuiteRunPlanResult,
  type SuiteScope,
  type SuiteTarget,
} from "@langwatch/suite-contract";

import type { SuiteExecution } from "../app/suite.app.ts";
import {
  suiteSlugOf,
  TARGET_SECRET_REFUSAL,
  targetsOverrideASecret,
} from "../rules/suite-target.rules.ts";
import { SuiteRunMappingService } from "./suite-run-mapping.service.ts";
import { SuiteRunReferencesService } from "./suite-run-references.service.ts";
import { SuiteRunScopeService } from "./suite-run-scope.service.ts";
import type { SuiteServiceOptions } from "./suite.service.ts";

type SuiteRunServiceOptions = {
  options: SuiteServiceOptions;
  /** The owning service's own read, so a run refuses a missing suite the same way. */
  get: (input: SuiteIdInput) => Promise<Suite>;
  /** The owning service's check of a plan's own evaluators. */
  readPlanEvaluators: (input: {
    projectId: string;
    attachments: EvaluatorAttachment[];
  }) => Promise<EvaluatorAttachment[]>;
  testSuiteToSuite: (testSuite: ScenarioTestSuite) => Suite;
  /** The owning service's id for a suite it creates. */
  newSuiteId: () => string;
};

export class SuiteRunService {
  static create(deps: SuiteRunServiceOptions): SuiteRunService {
    return new SuiteRunService(deps);
  }

  private readonly scope: SuiteRunScopeService;
  private readonly mappings: SuiteRunMappingService;
  private readonly references: SuiteRunReferencesService;

  private constructor(private readonly deps: SuiteRunServiceOptions) {
    this.scope = SuiteRunScopeService.create(deps.options);
    this.mappings = SuiteRunMappingService.create(deps.options);
    this.references = SuiteRunReferencesService.create(deps.options);
  }

  private get options(): SuiteServiceOptions {
    return this.deps.options;
  }

  private get(input: SuiteIdInput): Promise<Suite> {
    return this.deps.get(input);
  }

  async run(input: SuiteRunInput): Promise<SuiteRunResult & { planSlug: string }> {
    const parsed = suiteRunInputSchema.parse(input);
    const suite = await this.get({
      id: parsed.id,
      projectId: parsed.projectId,
    });
    const { scenarios } = this.options;
    if (suite.targets.length === 0) {
      throw new SuiteTargetsRequiredError();
    }
    await this.references.assertVoiceTargetsAllowed({
      targets: suite.targets,
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
    });

    const scope = parseSuiteScope(suite.scope);
    const scenarioIds = await this.scope.resolveRunMembership({
      suite,
      scopeIsDynamic: isDynamicScope(scope),
      projectId: parsed.projectId,
    });
    if (isDynamicScope(scope) && scenarioIds.length === 0) {
      throw new SuiteScopeEmptyError();
    }

    const { scenarioResolution, targetResolution } = await this.references.resolveRunReferences({
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
    await this.mappings.assertRunMappings({
      projectId: parsed.projectId,
      scenarioIds: scenarioResolution.active,
      planId: suite.id,
      planAttachments: await this.options.repository.findPlanEvaluators({
        id: suite.id,
        projectId: parsed.projectId,
      }),
    });

    const result = await this.execute({
      suite,
      parsed,
      scenarioResolution,
      targetResolution,
      scenarioConfigs,
      activeTargets: targetResolution.active,
    });

    return { ...result, planSlug: suite.slug };
  }

  /**
   * Starts a run under a NAME, which is what identifies a run plan: the name either joins an
   * existing plan and replaces its config, or creates one.
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  async runPlan(input: SuiteRunPlanInput): Promise<SuiteRunPlanResult> {
    const parsed = suiteRunPlanInputSchema.parse(input);
    const { repository } = this.options;

    if (parsed.config.targets.length === 0) {
      throw new SuiteTargetsRequiredError();
    }
    await this.references.assertVoiceTargetsAllowed({
      targets: parsed.config.targets,
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
    });

    const { scope, scenarioIds } = await this.planScope(parsed);

    const { scenarioResolution, targetResolution, namedTargets } =
      await this.references.resolveRunReferences({
        scenarioIds,
        targets: parsed.config.targets,
        sortTargets: true,
        projectId: parsed.projectId,
        organizationId: parsed.organizationId,
        actor: parsed.actor,
      });

    const scenarioConfigs = await this.checkedPlanConfigs({ parsed, scenarioResolution });

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

    const evaluators = await this.checkedPlanEvaluators({
      parsed,
      name,
      scenarioIds: scenarioResolution.active,
    });

    const { suite, created } = await repository.findOrCreatePlanByName({
      id: this.deps.newSuiteId(),
      projectId: parsed.projectId,
      name,
      scope,
      targets,
      scenarioIds,
      config: { ...parsed.config, ...(evaluators === undefined ? {} : { evaluators }) },
    });

    const result = await this.execute({
      suite,
      parsed,
      scenarioResolution,
      targetResolution,
      scenarioConfigs,
      activeTargets,
    });

    return { ...result, suiteId: suite.id, planName: suite.name, planSlug: suite.slug, created };
  }

  /**
   * A refusal here (e.g. a missing secret) must throw before the plan row is touched,
   * matching `prepareRun` on main: nothing is written for a run that will not hold up.
   */
  private async checkedPlanConfigs({
    parsed,
    scenarioResolution,
  }: {
    parsed: SuiteRunPlanInput;
    scenarioResolution: { active: string[] };
  }) {
    const { scenarios } = this.options;
    const scenarioConfigs = await scenarios.getRunConfigs({
      ids: scenarioResolution.active,
      projectId: parsed.projectId,
    });
    await scenarios.resolveRunParametersForScenarios({
      scenarios: scenarioConfigs,
      values: parsed.parameters,
    });
    SuiteRunService.assertNoSecretOverrides({
      scenarios: scenarioConfigs,
      targets: parsed.config.targets,
    });

    return scenarioConfigs;
  }

  /** The plan's own evaluators, read once its scope's mappings are known to hold. */
  private async checkedPlanEvaluators({
    parsed,
    name,
    scenarioIds,
  }: {
    parsed: SuiteRunPlanInput;
    name: string;
    scenarioIds: string[];
  }): Promise<EvaluatorAttachment[] | undefined> {
    const { repository } = this.options;
    const evaluators =
      parsed.config.evaluators === undefined
        ? undefined
        : await this.deps.readPlanEvaluators({
            projectId: parsed.projectId,
            attachments: parsed.config.evaluators,
          });
    const [existingPlanId] = await repository.findPlanIdsByName({
      projectId: parsed.projectId,
      name,
    });
    await this.mappings.assertRunMappings({
      projectId: parsed.projectId,
      scenarioIds,
      planId: existingPlanId,
      planAttachments:
        evaluators ??
        (existingPlanId === undefined
          ? []
          : await repository.findPlanEvaluators({
              id: existingPlanId,
              projectId: parsed.projectId,
            })),
    });

    return evaluators;
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

  async runAll(input: SuiteRunAllInput): Promise<SuiteRunAllResult> {
    const parsed = suiteRunAllInputSchema.parse(input);
    // Refused before the managed Run-all row is written; `run` asks again for the stored targets.
    await this.references.assertVoiceTargetsAllowed({
      targets: parsed.targets ?? [],
      projectId: parsed.projectId,
      organizationId: parsed.organizationId,
    });
    const scenarioIds = (await this.options.scenarios.list({ projectId: parsed.projectId })).map(
      (scenario) => scenario.id,
    );
    const suite = await this.options.repository.saveManagedRunAll({
      id: this.deps.newSuiteId(),
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
}
