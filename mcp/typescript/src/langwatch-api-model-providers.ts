import { makeRequest } from "./langwatch-api.js";

// --- Model Provider types ---

export interface ModelProviderEntry {
  id?: string;
  provider: string;
  enabled: boolean;
  customKeys: Record<string, unknown> | null;
  models?: string[] | null;
  embeddingsModels?: string[] | null;
  customModels?: unknown[] | null;
  customEmbeddingsModels?: unknown[] | null;
  disabledByDefault?: boolean;
  deploymentMapping?: unknown;
  extraHeaders?: Array<{ key: string; value: string }> | null;
}

// --- Model Provider API functions ---

/** Lists all model providers for the project, with masked API keys. */
export async function listModelProviders(): Promise<Record<string, ModelProviderEntry>> {
  return makeRequest("GET", "/api/model-providers") as Promise<
    Record<string, ModelProviderEntry>
  >;
}

/** Creates or updates a model provider. */
export async function setModelProvider(params: {
  provider: string;
  enabled: boolean;
  customKeys?: Record<string, unknown>;
  defaultModel?: string;
}): Promise<Record<string, ModelProviderEntry>> {
  const { provider, ...data } = params;
  return makeRequest(
    "PUT",
    `/api/model-providers/${encodeURIComponent(provider)}`,
    data,
  ) as Promise<Record<string, ModelProviderEntry>>;
}
