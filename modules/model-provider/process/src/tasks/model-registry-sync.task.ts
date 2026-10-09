import fs from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  LLMModelEntry,
  LLMModelPricing,
  LLMModelRegistry,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import { nowInstant } from "@langwatch/time";
import { OpenRouter } from "@openrouter/sdk";
import type { Model } from "@openrouter/sdk/models";

import type {
  DoublewordModelChannel,
  DoublewordModelList,
} from "../channels/doubleword-model.channel.ts";
import { HttpDoublewordModelChannel } from "../channels/http/http.doubleword-model.channel.ts";
import { HttpLitellmPriceChannel } from "../channels/http/http.litellm-price.channel.ts";
import type {
  LitellmPriceChannel,
  LitellmPriceRegistry,
} from "../channels/litellm-price.channel.ts";
import {
  auditCatalog,
  blockingFindings,
  renderAuditMarkdown,
  withoutAcceptedCrossSource,
  type AuditBaseline,
  type AuditReport,
} from "../rules/catalog-price-audit.rules.ts";
import { resolveDoublewordEntries } from "../rules/doubleword-models.rules.ts";
import { applyLitellmPreference } from "../rules/litellm-preferred.rules.ts";
import {
  litellmPricingById,
  mapLitellmModels,
  type UnrepresentableModel,
} from "../rules/litellm-prices.rules.ts";
import {
  extractProvider,
  hasVariantSuffix,
  mapModelId,
  mapProviderName,
} from "../rules/provider-id-mapping.rules.ts";
import { pickReasoningConfig } from "../rules/reasoning-config.rules.ts";

const logger = createLogger("langwatch:task:model-registry-sync");

const OUTPUT_PATH = fileURLToPath(
  new URL("../../../contract/src/catalog/model-catalog.json", import.meta.url),
);
// The hand-curated overlay: any model id present there is skipped by the
// litellm and Doubleword merges, so manual price corrections always win over the sync.
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

/** The catalog currently on disk (empty if unreadable). */
function readPreviousModels(): Record<string, LLMModelEntry> {
  try {
    const previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")) as {
      models?: Record<string, LLMModelEntry>;
    };
    return previous.models ?? {};
  } catch (error) {
    logger.warn({ error }, "Could not read the previous catalog");
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
 * The one raw-pricing key the SDK's generated schema omits:
 * `input_cache_write_1h` (32 of 413 models, all Anthropic, as of 2026-08-15).
 * Needs the raw response, fetched once more without the SDK.
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
function normalizeDescription(description: string | undefined): string | undefined {
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
    description: normalizeDescription(model.description),
    supportsImageInput: hasModality(model.architecture?.inputModalities, "image"),
    supportsAudioInput: hasModality(model.architecture?.inputModalities, "audio"),
    supportsImageOutput: hasModality(model.architecture?.outputModalities, "image"),
    supportsAudioOutput: hasModality(model.architecture?.outputModalities, "audio"),
  };

  const reasoningConfig = pickReasoningConfig(mappedId);
  if (reasoningConfig) entry.reasoningConfig = reasoningConfig;

  return entry;
}

const DOUBLEWORD_KEY_NOT_SET: DoublewordModelList = {
  outcome: "unavailable",
  reason: "key_not_set",
  detail: "DOUBLEWORD_API_KEY is not set",
};

/**
 * Merges Doubleword's models into the catalog. Ids the overlay or an earlier
 * source already covers are left alone.
 */
async function mergeDoublewordModels({
  transformedModels,
  overlayModels,
  apiKey,
  doubleword,
}: {
  transformedModels: Record<string, LLMModelEntry>;
  overlayModels: Record<string, LLMModelEntry>;
  apiKey: string | undefined;
  doubleword: DoublewordModelChannel;
}): Promise<void> {
  const excludeIds = new Set([...Object.keys(overlayModels), ...Object.keys(transformedModels)]);
  logger.info("Fetching models from Doubleword");
  const list = apiKey ? await doubleword.fetchModels({ apiKey }) : DOUBLEWORD_KEY_NOT_SET;
  if (list.outcome === "unavailable") {
    logger.warn(
      { reason: list.reason, detail: list.detail },
      "Doubleword models not read; keeping the Doubleword models already in the catalog",
    );
  }
  const fetched = list.outcome === "fetched" ? list.models : undefined;
  const entries = resolveDoublewordEntries({
    fetched,
    previousModels: fetched ? {} : readPreviousModels(),
    excludeIds,
  });
  for (const entry of entries) transformedModels[entry.id] = entry;
  logger.info(
    { received: fetched?.length ?? 0, merged: entries.length, source: list.outcome },
    "Merged Doubleword models",
  );
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
  litellmPrices: LitellmPriceRegistry;
  unrepresentable: UnrepresentableModel[];
}): AuditReport {
  const upstream: Record<string, Record<string, LLMModelPricing>> = {};
  if (litellmPrices.outcome === "fetched") {
    upstream.litellm = litellmPricingById(litellmPrices.prices);
  }

  const baseline = readAuditBaseline();
  const report = withoutAcceptedCrossSource(
    auditCatalog({ overlay, generated, upstream, unrepresentable }),
    baseline,
  );
  const blocking = blockingFindings(report, baseline);

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

/** Logs what the written catalog holds, by provider and by mode. */
function logCatalogSummary(models: Record<string, LLMModelEntry>): void {
  const entries = Object.values(models);
  const countByMode = (mode: LLMModelEntry["mode"]): number =>
    entries.filter((model) => model.mode === mode).length;
  logger.info(
    {
      providers: [...new Set(entries.map((model) => model.provider))].toSorted(),
      withReasoningParameter: entries.filter(
        (model) =>
          model.supportedParameters.includes("reasoning") ||
          model.supportedParameters.includes("reasoning_effort"),
      ).length,
      withReasoningConfig: entries.filter((model) => model.reasoningConfig !== undefined).length,
      multimodal: entries.filter((model) => model.supportsImageInput || model.supportsAudioInput)
        .length,
      chat: countByMode("chat"),
      embedding: countByMode("embedding"),
      audio: countByMode("audio"),
      image: countByMode("image"),
    },
    "Catalog summary",
  );
}

/**
 * Fetches every model from OpenRouter (chat plus embeddings), merges in
 * litellm's audio and image families and Doubleword's hosted models, and
 * writes `model-catalog.json`. The overlay file is read, but never written, here.
 */
export async function syncModelRegistry({
  apiKey,
  doublewordApiKey,
  litellm,
  doubleword,
}: {
  apiKey: string;
  doublewordApiKey: string | undefined;
  litellm: LitellmPriceChannel;
  doubleword: DoublewordModelChannel;
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
  logger.info(
    {
      count: rawPricing.size,
      withHourLongCacheWrite: [...rawPricing.values()].filter(
        (pricing) => pricing.input_cache_write_1h,
      ).length,
    },
    "Raw pricing available",
  );

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

  logger.info("Fetching audio and image model prices from litellm");
  const overlayModels = readOverlayModels();
  const litellmPrices = await litellm.fetchPriceRegistry();
  let unrepresentable: UnrepresentableModel[] = [];
  if (litellmPrices.outcome === "fetched") {
    const excludeIds = new Set([...Object.keys(overlayModels), ...Object.keys(transformedModels)]);
    const mapping = mapLitellmModels(litellmPrices.prices, excludeIds);
    unrepresentable = mapping.unrepresentable;
    for (const entry of mapping.entries) {
      transformedModels[entry.id] = entry;
    }
    logger.info({ count: mapping.entries.length }, "Merged audio and image models from litellm");
    if (unrepresentable.length > 0) {
      logger.warn(
        { ids: unrepresentable.map((model) => model.id) },
        "Models priced upstream but not expressible in the catalog",
      );
    }
  } else {
    logger.warn(
      { reason: litellmPrices.reason, detail: litellmPrices.detail },
      "litellm price fetch failed; audio and image models not merged this run",
    );
  }

  await mergeDoublewordModels({
    transformedModels,
    overlayModels,
    apiKey: doublewordApiKey,
    doubleword,
  });

  // Where a person decided litellm is the right side of a price disagreement,
  // its rates are taken before the audit runs, so the audit checks what is written.
  if (litellmPrices.outcome === "fetched") {
    const preferred = applyLitellmPreference({
      models: transformedModels,
      litellmById: litellmPricingById(litellmPrices.prices),
    });
    logger.info({ ids: preferred }, "Took litellm's rates for the preferred models");
  }

  auditAndReport({
    generated: transformedModels,
    overlay: overlayModels,
    litellmPrices,
    unrepresentable,
  });

  const registry: LLMModelRegistry = {
    updatedAt: nowInstant().toString({ fractionalSecondDigits: 3 }),
    modelCount: Object.keys(transformedModels).length,
    models: transformedModels,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2));
  logger.info({ modelCount: registry.modelCount, outputPath: OUTPUT_PATH }, "Wrote model catalog");
  logCatalogSummary(transformedModels);

  return { modelCount: registry.modelCount, outputPath: OUTPUT_PATH, errors };
}

/**
 * The task-launcher entry: `pnpm --filter @langwatch/tasks task model-registry-sync`.
 * Regenerates `model-catalog.json`; never touches `model-catalog.overlay.json`. Without
 * `DOUBLEWORD_API_KEY` (a platform key) the Doubleword entries already in the catalog are kept.
 */
export class ModelRegistrySyncTask extends Task {
  readonly name = "model-registry-sync";
  readonly description =
    "Regenerates model-catalog.json from OpenRouter, litellm's price registry and Doubleword.";

  private constructor(
    private readonly keys: {
      apiKey: () => string | undefined;
      doublewordApiKey: () => string | undefined;
    },
    private readonly litellm: LitellmPriceChannel,
    private readonly doubleword: DoublewordModelChannel,
  ) {
    super();
  }

  static create({
    apiKey,
    doublewordApiKey = () => undefined,
  }: {
    apiKey: () => string | undefined;
    doublewordApiKey?: () => string | undefined;
  }): ModelRegistrySyncTask {
    return new ModelRegistrySyncTask(
      { apiKey, doublewordApiKey },
      HttpLitellmPriceChannel.create(),
      HttpDoublewordModelChannel.create(),
    );
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const apiKey = this.keys.apiKey();
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY environment variable is not set");
    }
    await syncModelRegistry({
      apiKey,
      doublewordApiKey: this.keys.doublewordApiKey(),
      litellm: this.litellm,
      doubleword: this.doubleword,
    });
  }
}
