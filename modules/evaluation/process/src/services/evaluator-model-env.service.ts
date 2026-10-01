import { isAzureEvaluatorType } from "@langwatch/evaluation-contract";
import type { AVAILABLE_EVALUATORS, EvaluatorTypes } from "@langwatch/evaluator-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

import type {
  EvaluationAzureSafetyCredentials,
  EvaluationInstallEnvironment,
  EvaluationModelEnv,
} from "../app/evaluation.members.ts";

/** The environment one evaluator runs with: its own variables, then its model's and embeddings'. */
export class EvaluatorModelEnvService implements EvaluationModelEnv {
  readonly #modelProviders: Pick<ModelProviderApi, "prepareEvaluatorModelEnv">;
  readonly #azureSafety: EvaluationAzureSafetyCredentials;
  readonly #environment: EvaluationInstallEnvironment;

  private constructor(options: {
    modelProviders: Pick<ModelProviderApi, "prepareEvaluatorModelEnv">;
    azureSafety: EvaluationAzureSafetyCredentials;
    environment: EvaluationInstallEnvironment;
  }) {
    this.#modelProviders = options.modelProviders;
    this.#azureSafety = options.azureSafety;
    this.#environment = options.environment;
  }

  static create(options: {
    modelProviders: Pick<ModelProviderApi, "prepareEvaluatorModelEnv">;
    azureSafety: EvaluationAzureSafetyCredentials;
    environment: EvaluationInstallEnvironment;
  }): EvaluatorModelEnvService {
    return new EvaluatorModelEnvService(options);
  }

  async resolveForEvaluator({
    evaluatorType,
    evaluator,
    projectId,
    settings,
  }: {
    evaluatorType: EvaluatorTypes;
    evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
    projectId: string;
    settings?: Record<string, unknown>;
  }): Promise<Record<string, string>> {
    let evaluatorEnv = await this.#ownEnvironment({ evaluatorType, evaluator, projectId });

    if (settings && typeof settings.model === "string" && evaluatorType !== "openai/moderation") {
      evaluatorEnv = {
        ...evaluatorEnv,
        ...(await this.#modelProviders.prepareEvaluatorModelEnv({
          projectId,
          model: settings.model,
          embeddings: false,
          settings,
        })),
      };
    }

    if (settings && typeof settings.embeddings_model === "string") {
      evaluatorEnv = {
        ...evaluatorEnv,
        ...(await this.#modelProviders.prepareEvaluatorModelEnv({
          projectId,
          model: settings.embeddings_model,
          embeddings: true,
          settings,
        })),
      };
    }

    return evaluatorEnv;
  }

  /** Azure reads the tenant's provider row only; the rest read the install's variables. */
  async #ownEnvironment(input: {
    evaluatorType: EvaluatorTypes;
    evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
    projectId: string;
  }): Promise<Record<string, string>> {
    if (isAzureEvaluatorType(input.evaluatorType)) {
      const azure = await this.#azureSafety.resolveForTenant({ tenantId: input.projectId });
      return azure.kind === "configured" ? azure.credentials : {};
    }

    const environment = this.#environment.read();
    return Object.fromEntries(
      (input.evaluator.envVars ?? []).flatMap((name) => {
        const value = environment[name];
        return value === undefined ? [] : [[name, value]];
      }),
    );
  }
}
