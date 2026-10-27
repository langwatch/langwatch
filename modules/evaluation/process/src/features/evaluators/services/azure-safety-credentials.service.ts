import { AZURE_SAFETY_PROVIDER_KEY } from "@langwatch/evaluation-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

/**
 * Azure Content Safety credentials, solely from the project's `azure_safety`
 * model provider: there is no environment fallback.
 * @see specs/evaluators/azure-safety-byok-gating.feature
 */
export class AzureSafetyCredentialsService {
  static create(
    modelProviders: Pick<ModelProviderApi, "getExecutionProviders">,
  ): AzureSafetyCredentialsService {
    return new AzureSafetyCredentialsService(modelProviders);
  }

  private constructor(
    private readonly modelProviders: Pick<ModelProviderApi, "getExecutionProviders">,
  ) {}

  async resolveForTenant(input: {
    tenantId: string;
  }): Promise<EvaluationAzureSafetyCredentialsResolution> {
    const providers = await this.modelProviders.getExecutionProviders({
      projectId: input.tenantId,
    });
    const provider = providers[AZURE_SAFETY_PROVIDER_KEY];
    if (!provider?.enabled) return { kind: "unconfigured" };

    const endpoint = provider.customKeys?.AZURE_CONTENT_SAFETY_ENDPOINT;
    const key = provider.customKeys?.AZURE_CONTENT_SAFETY_KEY;
    if (typeof endpoint !== "string" || endpoint.trim() === "") return { kind: "unconfigured" };
    if (typeof key !== "string" || key.trim() === "") return { kind: "unconfigured" };

    return {
      kind: "configured",
      credentials: { AZURE_CONTENT_SAFETY_ENDPOINT: endpoint, AZURE_CONTENT_SAFETY_KEY: key },
    };
  }
}

/**
 * The tenant's Azure Safety provider credentials, or that none is configured (the evaluation is
 * skipped).
 */
export type EvaluationAzureSafetyCredentialsResolution =
  | Readonly<{ kind: "configured"; credentials: Record<string, string> }>
  | Readonly<{ kind: "unconfigured" }>;
