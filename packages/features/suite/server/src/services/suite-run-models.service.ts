import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import {
  resolveRunModels,
  type ResolvedRunModels,
  type RunModelChoice,
  type ScenarioService,
} from "@langwatch/scenario-contract";

const logger = createLogger("langwatch:suite-run:run-models");

/**
 * Reads, at queue time, the models each run of a suite batch will run on: the
 * scenario's own choice, then the project default per role. Never throws; an
 * unresolvable batch records no models. @see specs/scenarios/resolved-run-models-on-runs.feature
 */
export class SuiteRunModelsService {
  static create(options: {
    scenarios: ScenarioService;
    modelProviders: ModelProviderService;
  }): SuiteRunModelsService {
    return new SuiteRunModelsService(options.scenarios, options.modelProviders);
  }

  private constructor(
    private readonly scenarios: ScenarioService,
    private readonly modelProviders: ModelProviderService,
  ) {}

  /** The models each named scenario will run on, keyed by scenario id. */
  readonly resolve = async ({
    projectId,
    scenarioIds,
    plan,
  }: {
    projectId: string;
    scenarioIds: string[];
    plan: RunModelChoice;
  }): Promise<Map<string, ResolvedRunModels>> => {
    const { scenarios, modelProviders } = this;
    const resolved = new Map<string, ResolvedRunModels>();
    if (scenarioIds.length === 0) return resolved;

    try {
      const uniqueIds = Array.from(new Set(scenarioIds));
      // One read for the whole batch: a 200-scenario "all" plan is one round
      // trip at queue time, not 200.
      const rows = await scenarios.getModelChoices({ ids: uniqueIds, projectId });
      const choiceById = new Map<string, RunModelChoice>(
        rows.map((row) => [
          row.id,
          { simulatorModel: row.simulatorModel, judgeModel: row.judgeModel },
        ]),
      );

      // One project default per role for the whole batch: every scenario of it
      // asks the same question of the same project.
      const defaults = new Map<string, Promise<string>>();
      const resolveFeatureModel = (featureKey: string) => {
        const pending =
          defaults.get(featureKey) ??
          modelProviders.tryGetResolvedDefault({ projectId, featureKey }).then((resolution) => {
            if (!resolution) {
              throw new Error(`No model configured for "${featureKey}" (project: ${projectId}).`);
            }
            return resolution.model;
          });
        defaults.set(featureKey, pending);
        return pending;
      };

      for (const scenarioId of uniqueIds) {
        resolved.set(
          scenarioId,
          await resolveRunModels({
            plan,
            scenario: choiceById.get(scenarioId) ?? {},
            resolveFeatureModel,
          }),
        );
      }
    } catch (error) {
      logger.warn(
        { error, projectId },
        "Could not resolve the models for the queued runs; they record none",
      );
      return new Map();
    }

    return resolved;
  };
}

/** The shape `SuiteExecutionService` takes the resolution as. */
export type SuiteRunModelsResolver = SuiteRunModelsService["resolve"];
