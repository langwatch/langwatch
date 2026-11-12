/**
 * Turns manager-written model config into pi's `models.json`. The API key
 * uses pi's env REFERENCE syntax, never touching disk. Starts from pi's OWN
 * catalog when known, for request-shape knowledge the manager lacks.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";

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
 * pi catalogs by the gateway's provider prefix. Only prefixes whose API lane
 * can match are mapped - `openai_codex/*` runs openai-responses while pi
 * catalogs those under its own codex dialect, so those entries never apply.
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

const CLAUDE_VERSION_PATTERN = /^claude-(?:opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|$)/;

/** Claude 4.6 and later answer the legacy `thinking.type: "enabled"` shape with a 400. */
function isAdaptiveThinkingClaude(modelId: string): boolean {
  const match = CLAUDE_VERSION_PATTERN.exec(modelId.slice(modelId.indexOf("/") + 1));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  return major > 4 || (major === 4 && minor >= 6);
}

/** A Claude newer than pi's catalog gets the request shape its catalog siblings carry. */
function uncataloguedCompat(model: LangyWorkerModelConfig): Record<string, unknown> | undefined {
  if (model.api !== "anthropic-messages" || !isAdaptiveThinkingClaude(model.id)) return undefined;
  return { forceAdaptiveThinking: true, ...model.compat };
}

const GPT_VERSION_PATTERN = /^gpt-(\d+)(?:\.(\d+))?(?:-([a-z]+))?$/;

type GptVersion = { major: number; minor: number; tier: string | undefined };

function parseGptVersion(id: string): GptVersion | undefined {
  const match = GPT_VERSION_PATTERN.exec(id);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0), tier: match[3] };
}

const isNewer = (a: GptVersion, b: GptVersion) =>
  a.major !== b.major ? a.major > b.major : a.minor > b.minor;

/**
 * pi's newest catalog GPT of the same tier (`luna`, `sol`, ...), or of no tier, for a GPT newer
 * than every entry pi lists. pi's defaults for an unknown model are a 128k window and text-only
 * input, so a gpt-6 written from config alone compacted at a tenth of its window.
 */
function newerGptSibling(model: LangyWorkerModelConfig): CatalogModelEntry | undefined {
  if (model.api !== "openai-responses" || !model.id.startsWith("openai/")) return undefined;
  const wanted = parseGptVersion(model.id.slice("openai/".length));
  if (!wanted) return undefined;
  let best: { version: GptVersion; entry: CatalogModelEntry } | undefined;
  for (const [id, entry] of Object.entries(CATALOG_BY_PREFIX.openai ?? {})) {
    const version = parseGptVersion(id);
    if (!entry || !version || version.tier !== wanted.tier || entry.api !== model.api) continue;
    if (!best || isNewer(version, best.version)) best = { version, entry };
  }
  if (!best || !isNewer(wanted, best.version)) return undefined;
  // The sibling lends its request shape and limits, never its name or price.
  const { name: _name, cost: _cost, ...shape } = best.entry;
  return shape;
}

/**
 * Whether the model reasons is a fact about the model, not about the lane: the manager marks every
 * model of a reasoning-capable lane, and OpenAI answers a reasoning field on gpt-4o or gpt-4.1
 * with a 400.
 */
function catalogReasoning(catalog: CatalogModelEntry, entry: Record<string, unknown>) {
  if (typeof catalog.reasoning === "boolean") entry.reasoning = catalog.reasoning;
}

function buildModelEntry(model: LangyWorkerModelConfig): Record<string, unknown> {
  const {
    baseUrlEnv: _baseUrlEnv,
    apiKeyEnv: _apiKeyEnv,
    // Unknown keys pass through (config.ts) so a new compat finding needs no
    // wrapper change. Routing/credential keys are the exception and are dropped:
    // a model-level baseUrl/provider would bypass the mediated gateway, and a
    // literal apiKey would put the secret in models.json instead of by env name.
    baseUrl: _configBaseUrl,
    provider: _configProvider,
    apiKey: _configApiKey,
    ...configEntry
  } = model as LangyWorkerModelConfig & {
    baseUrl?: unknown;
    provider?: unknown;
    apiKey?: unknown;
  };
  const catalog = catalogEntryFor(model) ?? newerGptSibling(model);
  if (!catalog) {
    const compat = uncataloguedCompat(model);
    return compat ? { ...configEntry, compat } : configEntry;
  }
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
  catalogReasoning(catalog, entry);
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
