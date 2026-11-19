import { isAzureEvaluatorType } from "@langwatch/evaluation-contract";
import type { AVAILABLE_EVALUATORS, EvaluatorTypes } from "@langwatch/evaluator-contract";
import type {
  ModelProviderApi,
  ModelProviderEvaluatorModelEnv,
} from "@langwatch/model-provider-contract";

import type { AzureSafetyCredentialsService } from "./azure-safety-credentials.service.ts";
import type { EvaluatorEnvironmentService } from "./evaluator-environment.service.ts";

/**
 * The environment one evaluator runs with (its own variables, then its model's and embeddings'),
 * and the headers langevals is posted to with when a model call goes through nlpgo (ADR-203).
 */
export class EvaluatorModelEnvService {
  readonly #modelProviders: Pick<ModelProviderApi, "prepareEvaluatorModelEnv">;
  readonly #azureSafety: Pick<AzureSafetyCredentialsService, "resolveForTenant">;
  readonly #environment: Pick<EvaluatorEnvironmentService, "read">;

  private constructor(options: {
    modelProviders: Pick<ModelProviderApi, "prepareEvaluatorModelEnv">;
    azureSafety: Pick<AzureSafetyCredentialsService, "resolveForTenant">;
    environment: Pick<EvaluatorEnvironmentService, "read">;
  }) {
    this.#modelProviders = options.modelProviders;
    this.#azureSafety = options.azureSafety;
    this.#environment = options.environment;
  }

  static create(options: {
    modelProviders: Pick<ModelProviderApi, "prepareEvaluatorModelEnv">;
    azureSafety: Pick<AzureSafetyCredentialsService, "resolveForTenant">;
    environment: Pick<EvaluatorEnvironmentService, "read">;
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
  }): Promise<ModelProviderEvaluatorModelEnv> {
    let resolved: ModelProviderEvaluatorModelEnv = {
      env: await this.#ownEnvironment({ evaluatorType, evaluator, projectId }),
      headers: {},
    };

    if (settings && typeof settings.model === "string" && evaluatorType !== "openai/moderation") {
      resolved = merged(
        resolved,
        await this.#modelProviders.prepareEvaluatorModelEnv({
          projectId,
          model: settings.model,
          embeddings: false,
          settings,
        }),
      );
    }

    if (settings && typeof settings.embeddings_model === "string") {
      resolved = merged(
        resolved,
        await this.#modelProviders.prepareEvaluatorModelEnv({
          projectId,
          model: settings.embeddings_model,
          embeddings: true,
          settings,
        }),
      );
    }

    return resolved;
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

/** The later block's variables and headers over the earlier one's. */
function merged(
  earlier: ModelProviderEvaluatorModelEnv,
  later: ModelProviderEvaluatorModelEnv,
): ModelProviderEvaluatorModelEnv {
  return {
    env: { ...earlier.env, ...later.env },
    headers: { ...earlier.headers, ...later.headers },
  };
}
