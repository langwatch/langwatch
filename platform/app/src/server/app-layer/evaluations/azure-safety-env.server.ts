import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { getProjectModelProviders } from "@langwatch/model-provider-server";
import { AZURE_SAFETY_PROVIDER_KEY } from "@langwatch/evaluation-contract";

/**
 * Resolves Azure Content Safety credentials for a project from its per-project
 * `azure_safety` model provider. This is the ONLY source of truth — there is
 * no process.env fallback, so running Azure evaluators without a configured
 * provider yields a deterministic null.
 */
export async function getAzureSafetyEnvFromProject(
  modelProvidersService: ModelProviderService,
  projectId: string,
): Promise<Record<string, string> | null> {
  const modelProviders = await getProjectModelProviders(modelProvidersService, projectId);
  const provider = modelProviders[AZURE_SAFETY_PROVIDER_KEY];

  if (!provider?.enabled) {
    return null;
  }

  const endpoint = provider.customKeys?.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key = provider.customKeys?.AZURE_CONTENT_SAFETY_KEY;

  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    return null;
  }
  if (typeof key !== "string" || key.trim() === "") {
    return null;
  }

  return {
    AZURE_CONTENT_SAFETY_ENDPOINT: endpoint,
    AZURE_CONTENT_SAFETY_KEY: key,
  };
}
