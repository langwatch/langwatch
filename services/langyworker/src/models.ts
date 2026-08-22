/**
 * Turns the manager-written model config into a generated pi `models.json`
 * under the wrapper's private agent dir. Two rules keep secrets off disk:
 * the base URL (a loopback gateway URL, not secret) is resolved from the env
 * at boot and written literally; the API key is written as pi's env REFERENCE
 * syntax (`"$OPENAI_API_KEY"`), resolved by pi at request time.
 *
 * The entry starts from pi's OWN catalog when the model is known there for the
 * same API dialect: the catalog carries per-model request-shape knowledge the
 * manager's config does not (Claude 5's `compat.forceAdaptiveThinking`, the
 * thinking-level map, the real context window), and losing it broke every
 * turn on those models. The manager's explicit fields win over the catalog;
 * the id keeps its provider prefix (the gateway routes on it), and the
 * catalog's own endpoint and provider identity never ride along.
 */

import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LangyWorkerModelConfig } from "./config.js";

export const PROVIDER_ID = "langwatch-gateway";

export type GeneratedModels = {
  modelsPath: string;
  providerId: string;
  modelId: string;
};

type CatalogModelEntry = Record<string, unknown> & {
  api?: unknown;
  compat?: Record<string, unknown>;
};

/**
 * pi catalogs by the gateway's provider prefix. Only the prefixes whose API
 * lane can actually match are mapped: `openai_codex/*` runs our
 * openai-responses lane while pi catalogs those models under its own
 * codex-specific dialect, so its entries never apply (the api guard below
 * would skip them anyway), and the chat-completions prefixes have no
 * per-model compat worth inheriting.
 */
const CATALOG_BY_PREFIX: Record<string, Record<string, CatalogModelEntry | undefined>> = {
  anthropic: ANTHROPIC_MODELS as unknown as Record<string, CatalogModelEntry>,
  openai: OPENAI_MODELS as unknown as Record<string, CatalogModelEntry>,
};

function catalogEntryFor(model: LangyWorkerModelConfig): CatalogModelEntry | undefined {
  const slash = model.id.indexOf("/");
  if (slash <= 0) return undefined;
  const entry = CATALOG_BY_PREFIX[model.id.slice(0, slash)]?.[model.id.slice(slash + 1)];
  // A catalog entry for a DIFFERENT API dialect than the manager chose must
  // not leak its request-shape flags into ours.
  if (!entry || entry.api !== model.api) return undefined;
  return entry;
}

function buildModelEntry(model: LangyWorkerModelConfig): Record<string, unknown> {
  const { baseUrlEnv: _baseUrlEnv, apiKeyEnv: _apiKeyEnv, ...configEntry } = model;
  const catalog = catalogEntryFor(model);
  if (!catalog) return configEntry;
  const {
    // Ours stay authoritative: the provider-prefixed id is what the gateway
    // routes on, and the catalog's endpoint/provider identity would point pi
    // straight at the provider instead of through the mediated gateway.
    id: _id,
    api: _api,
    provider: _provider,
    baseUrl: _baseUrl,
    compat: catalogCompat,
    ...catalogBase
  } = catalog;
  const entry: Record<string, unknown> = { ...catalogBase, ...configEntry };
  const compat = { ...catalogCompat, ...model.compat };
  if (Object.keys(compat).length > 0) entry.compat = compat;
  return entry;
}

export function buildModelsJson({
  model,
  env,
}: {
  model: LangyWorkerModelConfig;
  env: Record<string, string | undefined>;
}): { providers: Record<string, unknown> } {
  const baseUrl = env[model.baseUrlEnv];
  if (!baseUrl) {
    throw new Error(`model.baseUrlEnv names "${model.baseUrlEnv}" but that variable is not set`);
  }
  if (!env[model.apiKeyEnv]) {
    throw new Error(`model.apiKeyEnv names "${model.apiKeyEnv}" but that variable is not set`);
  }
  return {
    providers: {
      [PROVIDER_ID]: {
        baseUrl,
        api: model.api,
        apiKey: `$${model.apiKeyEnv}`,
        models: [buildModelEntry(model)],
      },
    },
  };
}

export function writeModelsJson(options: {
  agentDir: string;
  model: LangyWorkerModelConfig;
  env: Record<string, string | undefined>;
}): GeneratedModels {
  const { agentDir, model, env } = options;
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const modelsPath = join(agentDir, "models.json");
  writeFileSync(modelsPath, `${JSON.stringify(buildModelsJson({ model, env }), null, 2)}\n`, {
    mode: 0o600,
  });
  return { modelsPath, providerId: PROVIDER_ID, modelId: model.id };
}
