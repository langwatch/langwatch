import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  LLMModelEntry,
  LLMModelPricing,
  LLMModelRegistry,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { OpenRouter } from "@openrouter/sdk";
import type { Model } from "@openrouter/sdk/models";
import {
  auditCatalog,
  blockingFindings,
  renderAuditMarkdown,
  type AuditBaseline,
  type AuditReport,
} from "../rules/catalog-price-audit.rules";
import {
  fetchLitellmPrices,
  litellmPricingById,
  mapLitellmAudioModels,
  type LitellmPriceEntry,
  type UnrepresentableModel,
} from "../rules/litellm-audio-prices.rules";
import {
  extractProvider,
  hasVariantSuffix,
  mapModelId,
  mapProviderName,
} from "../rules/provider-id-mapping.rules";
import { getReasoningConfig } from "../rules/reasoning-config.rules";

const logger = createLogger("langwatch:task:model-registry-sync");

const OUTPUT_PATH = fileURLToPath(
  new URL("../../../contract/src/catalog/model-catalog.json", import.meta.url),
);
// The hand-curated overlay: any model id present there is skipped by the
// litellm audio merge, so manual price corrections always win over the sync.
const OVERLAY_PATH = fileURLToPath(
  new URL("../../../contract/src/catalog/model-catalog.overlay.json", import.meta.url),
);
// Read by the sync workflow into the pull request body, so a drift or a
// missing price is on the page the reviewer already has open.
const AUDIT_PATH = fileURLToPath(
  new URL("../../../contract/src/catalog/model-registry-audit.md", import.meta.url),
);
// Findings already known and accepted, so the weekly run is green until
// something new appears.
const BASELINE_PATH = fileURLToPath(
  new URL("./model-registry-audit-baseline.json", import.meta.url),
);

/** Raw pricing keys the OpenRouter SDK's generated schema drops. */
type RawPricing = Record<string, string | number | undefined>;

const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const EMBEDDINGS_ENDPOINT = "https://openrouter.ai/api/v1/embeddings/models";

/** Hand-curated overlay models (empty if unreadable). */
function readOverlayModels(): Record<string, LLMModelEntry> {
  try {
    const overlay = JSON.parse(fs.readFileSync(OVERLAY_PATH, "utf8")) as {
      models?: Record<string, LLMModelEntry>;
    };
    return overlay.models ?? {};
  } catch (error) {
    logger.warn({ error }, "Could not read overlay");
    return {};
  }
}

/** Findings already known and accepted. */
function readAuditBaseline(): AuditBaseline {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as AuditBaseline;
  } catch (error) {
    logger.warn({ error }, "Could not read audit baseline");
    return {};
  }
}

/**
 * The one raw-pricing key the SDK's generated schema does not declare:
 * `input_cache_write_1h`, present for 32 of 413 models on a 2026-08-15 pull,
 * all Anthropic. Reading it needs the raw response, fetched once more
 * without the SDK and looked up by model id.
 */
async function fetchRawPricing(apiKey: string): Promise<Map<string, RawPricing>> {
  const byId = new Map<string, RawPricing>();
  try {
    const response = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "Failed to fetch raw model pricing");
      return byId;
    }
    const data = (await response.json()) as { data?: { id?: string; pricing?: RawPricing }[] };
    for (const model of data.data ?? []) {
      if (model.id && model.pricing) byId.set(model.id, model.pricing);
    }
  } catch (error) {
    logger.warn({ error }, "Error fetching raw model pricing");
  }
  return byId;
}

async function fetchEmbeddingModels(apiKey: string): Promise<Model[]> {
  try {
    const response = await fetch(EMBEDDINGS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "Failed to fetch embedding models");
      return [];
    }
    const data = (await response.json()) as { data?: Model[] };
    return data.data ?? [];
  } catch (error) {
    logger.warn({ error }, "Error fetching embedding models");
    return [];
  }
}

function transformPricing(pricing: Model["pricing"], raw?: RawPricing): LLMModelPricing {
  const parsePrice = (value: string | number | undefined): number =>
    value ? parseFloat(String(value)) || 0 : 0;

  const result: LLMModelPricing = {
    inputCostPerToken: parsePrice(pricing.prompt),
    outputCostPerToken: parsePrice(pricing.completion),
  };

  const inputCacheRead = parsePrice(pricing.inputCacheRead);
  if (inputCacheRead > 0) result.inputCacheReadPerToken = inputCacheRead;

  const inputCacheWrite = parsePrice(pricing.inputCacheWrite);
  if (inputCacheWrite > 0) result.inputCacheWritePerToken = inputCacheWrite;

  // The hour-long prompt-cache write rate. Without it the catalog falls back
  // to a hardcoded 2x-of-input derivation that only covers Anthropic ids.
  const inputCacheWrite1h = parsePrice(raw?.input_cache_write_1h);
  if (inputCacheWrite1h > 0) result.inputCacheWrite1hPerToken = inputCacheWrite1h;

  const imageCost = parsePrice(pricing.image);
  if (imageCost > 0) result.imageCostPerToken = imageCost;

  const imageOutput = parsePrice(pricing.imageOutput);
  if (imageOutput > 0) result.imageOutputCostPerToken = imageOutput;

  const audioCost = parsePrice(pricing.audio);
  if (audioCost > 0) result.audioCostPerToken = audioCost;

  const internalReasoning = parsePrice(pricing.internalReasoning);
  if (internalReasoning > 0) result.internalReasoningCostPerToken = internalReasoning;

  const webSearch = parsePrice(pricing.webSearch);
  if (webSearch > 0) result.webSearchCostPerQuery = webSearch;

  return result;
}

function determineMode(modality: string | null): "chat" | "embedding" {
  if (!modality) return "chat";
  return modality.includes("embedding") ? "embedding" : "chat";
}

function hasModality(modalities: string[] | undefined, type: string): boolean {
  return modalities?.includes(type) ?? false;
}

/** Strips OpenRouter promotional links from a model description. */
function sanitizeDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;
  let sanitized = description.replace(
    /\[([^\]]*)\]\(https?:\/\/(?:www\.)?openrouter\.ai[^)]*\)/gi,
    "",
  );
  sanitized = sanitized.replace(/https?:\/\/(?:www\.)?openrouter\.ai[^\s)"]*/gi, "");
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  return sanitized || undefined;
}

function transformModel(model: Model, raw?: RawPricing): LLMModelEntry {
  const originalProvider = extractProvider(model.id);
  const mappedProvider = mapProviderName(originalProvider);
  const mappedId = mapModelId(model.id);

  const entry: LLMModelEntry = {
    id: mappedId,
    name: model.name,
    provider: mappedProvider,
    pricing: transformPricing(model.pricing, raw),
    contextLength: model.contextLength ?? 0,
    maxCompletionTokens: model.topProvider?.maxCompletionTokens ?? null,
    supportedParameters: model.supportedParameters ?? [],
    defaultParameters: model.defaultParameters ?? null,
    modality: model.architecture?.modality ?? "text->text",
    mode: determineMode(model.architecture?.modality ?? null),
    description: sanitizeDescription(model.description),
    supportsImageInput: hasModality(model.architecture?.inputModalities, "image"),
    supportsAudioInput: hasModality(model.architecture?.inputModalities, "audio"),
    supportsImageOutput: hasModality(model.architecture?.outputModalities, "image"),
    supportsAudioOutput: hasModality(model.architecture?.outputModalities, "audio"),
  };

  const reasoningConfig = getReasoningConfig(mappedId);
  if (reasoningConfig) entry.reasoningConfig = reasoningConfig;

  return entry;
}

/**
 * Audits the catalog this run produced against litellm, writes the report,
 * and logs every blocking finding. litellm is independent of OpenRouter,
 * which is what makes a disagreement between them meaningful.
 */
function auditAndReport({
  generated,
  overlay,
  litellmPrices,
  unrepresentable,
}: {
  generated: Record<string, LLMModelEntry>;
  overlay: Record<string, LLMModelEntry>;
  litellmPrices: Record<string, LitellmPriceEntry> | null;
  unrepresentable: UnrepresentableModel[];
}): AuditReport {
  const upstream: Record<string, Record<string, LLMModelPricing>> = {};
  if (litellmPrices) upstream.litellm = litellmPricingById(litellmPrices);

  const report = auditCatalog({ overlay, generated, upstream, unrepresentable });
  const blocking = blockingFindings(report, readAuditBaseline());

  try {
    fs.writeFileSync(AUDIT_PATH, `${renderAuditMarkdown(report, blocking)}\n`);
  } catch (error) {
    logger.warn({ error }, "Could not write audit report");
  }

  for (const line of blocking) logger.warn({ line }, "Price audit finding");
  if (report.crossSource.length > 0) {
    const worst = report.crossSource[0]!;
    logger.info(
      { count: report.crossSource.length, worst: `${worst.modelId}.${worst.field}` },
      "Price audit: the two sources disagree",
    );
  }
  if (blocking.length === 0) logger.info("Price audit: no new findings");

  return report;
}

export type ModelRegistrySyncResult = {
  modelCount: number;
  outputPath: string;
  errors: string[];
};

/**
 * Fetches every model from OpenRouter (chat plus the separate embeddings
 * endpoint), merges in the audio/transcription/realtime family from
 * litellm's price registry (which OpenRouter does not route), audits the
 * result against litellm, and writes `model-catalog.json`. The overlay file
 * is read for exclusion and drift comparison; this task never writes it.
 */
export async function syncModelRegistry({
  apiKey,
}: {
  apiKey: string;
}): Promise<ModelRegistrySyncResult> {
  logger.info("Fetching models from OpenRouter API");
  const openRouter = new OpenRouter({ apiKey });
  const response = await openRouter.models.list();
  const chatModels = response.data;
  if (!chatModels || chatModels.length === 0) {
    throw new Error("No chat models returned from OpenRouter");
  }
  logger.info({ count: chatModels.length }, "Received chat models");

  const embeddingModels = await fetchEmbeddingModels(apiKey);
  logger.info({ count: embeddingModels.length }, "Received embedding models");

  const allModels = [...chatModels, ...embeddingModels];
  const models = allModels.filter((model) => !hasVariantSuffix(model.id));
  logger.info(
    { kept: models.length, excludedVariants: allModels.length - models.length },
    "Filtered variant suffixes",
  );

  const rawPricing = await fetchRawPricing(apiKey);

  const transformedModels: Record<string, LLMModelEntry> = {};
  const errors: string[] = [];
  for (const model of models) {
    try {
      const entry = transformModel(model, rawPricing.get(model.id));
      transformedModels[entry.id] = entry;
    } catch (error) {
      const message = `Failed to transform model ${model.id}: ${error instanceof Error ? error.message : String(error)}`;
      logger.warn({ modelId: model.id, error }, message);
      errors.push(message);
    }
  }

  logger.info("Fetching audio model prices from litellm");
  const overlayModels = readOverlayModels();
  const litellmPrices = await fetchLitellmPrices();
  let unrepresentable: UnrepresentableModel[] = [];
  if (litellmPrices) {
    const excludeIds = new Set([...Object.keys(overlayModels), ...Object.keys(transformedModels)]);
    const mapping = mapLitellmAudioModels(litellmPrices, excludeIds);
    unrepresentable = mapping.unrepresentable;
    for (const entry of mapping.entries) {
      transformedModels[entry.id] = entry;
    }
    logger.info({ count: mapping.entries.length }, "Merged audio models from litellm");
  } else {
    logger.warn("litellm price fetch failed; audio models not merged this run");
  }

  auditAndReport({
    generated: transformedModels,
    overlay: overlayModels,
    litellmPrices,
    unrepresentable,
  });

  const registry: LLMModelRegistry = {
    updatedAt: new Date().toISOString(),
    modelCount: Object.keys(transformedModels).length,
    models: transformedModels,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2));
  logger.info({ modelCount: registry.modelCount, outputPath: OUTPUT_PATH }, "Wrote model catalog");

  return { modelCount: registry.modelCount, outputPath: OUTPUT_PATH, errors };
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * model-registry-sync`. Regenerates `model-catalog.json` from OpenRouter and
 * litellm; never touches `model-catalog.overlay.json`.
 */
export class ModelRegistrySyncTask extends Task {
  readonly name = "model-registry-sync";
  readonly description =
    "Regenerates model-catalog.json from OpenRouter and litellm's price registry.";

  private constructor(private readonly apiKey: () => string | undefined) {
    super();
  }

  static create({ apiKey }: { apiKey: () => string | undefined }): ModelRegistrySyncTask {
    return new ModelRegistrySyncTask(apiKey);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY environment variable is not set");
    }
    await syncModelRegistry({ apiKey });
  }
}
