import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  mergeRunParameters,
  parseScenarioParameterDefinitions,
  partitionParameterDefinitions,
  renderScenarioContent,
  type RunParameterValues,
  type ScenarioService,
  withoutParameterNames,
} from "@langwatch/scenario-contract";
import { tryExtractSuiteId, type Suite, type SuiteService } from "@langwatch/suite-contract";

import type { ScenarioConfig } from "@langwatch/scenario-contract";

type FetchProjectResult =
  | { success: true; data: { apiKey: string } }
  | { success: false; error: string };

export class ScenarioExecutionLookupService {
  static create(options: {
    scenarios: ScenarioService;
    projects: ProjectService;
    suites: SuiteService;
    modelProviders: ModelProviderService;
  }): ScenarioExecutionLookupService {
    return new ScenarioExecutionLookupService(options);
  }

  private constructor(
    private readonly options: {
      scenarios: ScenarioService;
      projects: ProjectService;
      suites: SuiteService;
      modelProviders: ModelProviderService;
    },
  ) {}

  async tryFetchScenario({
    projectId,
    scenarioId,
    suppliedParameters,
  }: {
    projectId: string;
    scenarioId: string;
    suppliedParameters?: RunParameterValues;
  }): Promise<{
    config: ScenarioConfig;
    parameters: RunParameterValues;
    simulatorModel: string | null;
    judgeModel: string | null;
  } | null> {
    const scenario = await this.options.scenarios.tryGetById({
      projectId,
      id: scenarioId,
    });
    if (!scenario) {
      return null;
    }

    const definitions = parseScenarioParameterDefinitions(scenario.parameters);
    // The secret declarations are taken out before the merge, so no secret value
    // can reach `params` or the scenario's own text. They stay in
    // `declaredNames`, which is what makes a `params.SECRET` reference fail here
    // as a backstop, the same way the run request already refused it.
    const { plain, secret } = partitionParameterDefinitions(definitions);
    const parameters = mergeRunParameters({
      definitions: plain,
      values: withoutParameterNames({
        values: suppliedParameters,
        names: new Set(secret.map((definition) => definition.name)),
      }),
    });

    const rendered = await renderScenarioContent({
      situation: scenario.situation,
      criteria: scenario.criteria,
      parameters,
      declaredNames: definitions.map((definition) => definition.name),
    });
    if (!rendered.ok) {
      // The request that started this run rendered the same text against the
      // same values and accepted it, so reaching here means the scenario or its
      // parameters changed underneath a queued run. There is nothing the run can
      // do with that, and nothing the customer chose that explains it.
      throw new Error(
        `Scenario ${scenarioId} ${rendered.field} could not be rendered against the run's parameters (${rendered.reason})`,
      );
    }

    return {
      config: {
        id: scenario.id,
        name: scenario.name,
        situation: rendered.situation,
        criteria: rendered.criteria,
        labels: scenario.labels,
        maxTurns: scenario.maxTurns ?? undefined,
        minTurns: scenario.minTurns ?? undefined,
      },
      parameters,
      simulatorModel: scenario.simulatorModel ?? null,
      judgeModel: scenario.judgeModel ?? null,
    };
  }

  async fetchProject(projectId: string): Promise<FetchProjectResult> {
    const project = await this.options.projects.tryGetById(projectId);
    if (!project) {
      return { success: false, error: `Project ${projectId} not found` };
    }
    if (!project.apiKey) {
      return { success: false, error: `Project ${projectId} missing API key` };
    }
    return { success: true, data: { apiKey: project.apiKey } };
  }

  async tryFetchSuite({
    setId,
    projectId,
  }: {
    setId: string;
    projectId: string;
  }): Promise<Suite | null> {
    const suiteId = tryExtractSuiteId(setId);
    if (!suiteId) {
      return null;
    }
    return this.options.suites.tryGet({ id: suiteId, projectId });
  }

  async resolveModel({
    featureKey,
    projectId,
  }: {
    featureKey: string;
    projectId: string;
  }): Promise<string> {
    const resolved = await this.options.modelProviders.tryGetResolvedDefault({
      projectId,
      featureKey,
    });
    if (resolved) {
      return resolved.model;
    }

    throw new Error(
      `No model configured for "${featureKey}" (role: DEFAULT, project: ${projectId}).`,
    );
  }
}
