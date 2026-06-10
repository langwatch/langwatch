import { getProjectModelProviders } from "../../api/routers/modelProviders.utils";
import { AZURE_SAFETY_PROVIDER_KEY } from "./azure-safety-env";

/**
 * Resolves Azure Content Safety credentials for a project from its per-project
 * `azure_safety` model provider. This is the ONLY source of truth — there is
 * no process.env fallback, so running Azure evaluators without a configured
 * provider yields a deterministic null.
 */
export async function getAzureSafetyEnvFromProject(
  projectId: string,
): Promise<Record<string, string> | null> {
  const modelProviders = await getProjectModelProviders(projectId);
  const provider = modelProviders[AZURE_SAFETY_PROVIDER_KEY];

  if (!provider || !provider.enabled) {
    return null;
  }

  const customKeys = provider.customKeys as Record<string, unknown> | null;
  const endpoint = customKeys?.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key = customKeys?.AZURE_CONTENT_SAFETY_KEY;

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
