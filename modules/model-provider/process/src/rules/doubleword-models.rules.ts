import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";
import { z } from "zod";

/**
 * Doubleword models and prices. The catalog id is `doubleword/<model_name>` with the case kept,
 * because the API matches the name exactly. The price is the active realtime tariff: a
 * batch-only model is left out. Cache prices are multipliers of the input rate.
 */

const DOUBLEWORD_PROVIDER = "doubleword";

const doublewordTariffSchema = z.object({
  name: z.string().optional(),
  input_price_per_token: z.string().nullish(),
  output_price_per_token: z.string().nullish(),
  api_key_purpose: z.string(),
  is_active: z.boolean(),
  valid_until: z.string().nullish(),
});

const doublewordCachePricingSchema = z.object({
  enabled: z.boolean(),
  write_multiplier_5m: z.string().nullish(),
  write_multiplier_1h: z.string().nullish(),
  read_multiplier: z.string().nullish(),
});

/** The subset of a Doubleword admin model this mapper reads, parsed where the body enters. */
export const doublewordModelSchema = z.object({
  model_name: z.string(),
  display_name: z.string().nullish(),
  description: z.string().nullish(),
  model_type: z.string(),
  capabilities: z.array(z.string()).nullish(),
  tariffs: z.array(doublewordTariffSchema).nullish(),
  cache_pricing: doublewordCachePricingSchema.nullish(),
  metadata: z
    .object({
      context_window: z.number().nullish(),
      extra: z.object({ summary: z.string().nullish() }).nullish(),
    })
    .nullish(),
});

export type DoublewordModel = z.infer<typeof doublewordModelSchema>;
type DoublewordTariff = z.infer<typeof doublewordTariffSchema>;
type DoublewordCachePricing = z.infer<typeof doublewordCachePricingSchema>;

/** OpenAI chat parameters Doubleword's realtime API accepts on every chat model. */
const CHAT_PARAMETERS = [
  "frequency_penalty",
  "max_tokens",
  "presence_penalty",
  "response_format",
  "seed",
  "stop",
  "temperature",
  "tool_choice",
  "tools",
  "top_p",
];

function parsePrice(value: string | null | undefined): number {
  if (!value) return 0;
  return parseFloat(value) || 0;
}

/** The active realtime tariff, or undefined when the model is batch-only. */
function pickRealtimeTariff(model: DoublewordModel): DoublewordTariff | undefined {
  return model.tariffs?.find(
    (tariff) => tariff.api_key_purpose === "realtime" && tariff.is_active && !tariff.valid_until,
  );
}

/** Rate times multiplier, without float noise like 2.9999999999999997e-9. */
function scaleRate(rate: number, multiplier: number): number {
  return Number((rate * multiplier).toPrecision(12));
}

function mapPricing(
  tariff: DoublewordTariff,
  cache: DoublewordCachePricing | null | undefined,
): LLMModelPricing {
  const input = parsePrice(tariff.input_price_per_token);
  const pricing: LLMModelPricing = {
    inputCostPerToken: input,
    outputCostPerToken: parsePrice(tariff.output_price_per_token),
  };
  if (!cache?.enabled || input === 0) return pricing;

  const read = parsePrice(cache.read_multiplier);
  if (read > 0) pricing.inputCacheReadPerToken = scaleRate(input, read);
  const write = parsePrice(cache.write_multiplier_5m);
  if (write > 0) pricing.inputCacheWritePerToken = scaleRate(input, write);
  const write1h = parsePrice(cache.write_multiplier_1h);
  if (write1h > 0) pricing.inputCacheWrite1hPerToken = scaleRate(input, write1h);

  return pricing;
}

function modalityOf({
  isEmbedding,
  supportsImageInput,
}: {
  isEmbedding: boolean;
  supportsImageInput: boolean;
}): string {
  if (isEmbedding) return "text->embeddings";
  return supportsImageInput ? "text+image->text" : "text->text";
}

/**
 * Maps one Doubleword model to a catalog entry, or undefined when the model
 * has no realtime price or is a type the catalog does not cover.
 */
export function mapDoublewordModel(model: DoublewordModel): LLMModelEntry | undefined {
  const tariff = pickRealtimeTariff(model);
  if (!tariff) return undefined;

  const type = model.model_type.toUpperCase();
  if (type !== "CHAT" && type !== "EMBEDDINGS") return undefined;
  const isEmbedding = type === "EMBEDDINGS";
  const supportsImageInput = !isEmbedding && (model.capabilities ?? []).includes("vision");

  return {
    id: `${DOUBLEWORD_PROVIDER}/${model.model_name}`,
    name: `Doubleword: ${model.display_name || model.model_name}`,
    provider: DOUBLEWORD_PROVIDER,
    pricing: mapPricing(tariff, model.cache_pricing),
    contextLength: model.metadata?.context_window ?? 0,
    maxCompletionTokens: null,
    supportedParameters: isEmbedding ? [] : CHAT_PARAMETERS,
    defaultParameters: null,
    modality: modalityOf({ isEmbedding, supportsImageInput }),
    mode: isEmbedding ? "embedding" : "chat",
    description: model.metadata?.extra?.summary || model.description || undefined,
    supportsImageInput,
    supportsAudioInput: false,
    supportsImageOutput: false,
    supportsAudioOutput: false,
  };
}

/** Maps every Doubleword model the gateway can call, skipping `excludeIds`. */
export function mapDoublewordModels(
  models: readonly DoublewordModel[],
  excludeIds: ReadonlySet<string> = new Set(),
): LLMModelEntry[] {
  const entries: LLMModelEntry[] = [];
  for (const model of models) {
    const entry = mapDoublewordModel(model);
    if (entry && !excludeIds.has(entry.id)) entries.push(entry);
  }
  return entries;
}

/**
 * The Doubleword entries a sync run writes. Without a model list from this run (`fetched`
 * undefined), the Doubleword entries of the catalog already on disk are kept, so a bad run
 * does not delete them. `excludeIds` always wins, so an overlay correction is never contested.
 */
export function resolveDoublewordEntries({
  fetched,
  previousModels,
  excludeIds,
}: {
  fetched: readonly DoublewordModel[] | undefined;
  previousModels: Record<string, LLMModelEntry>;
  excludeIds: ReadonlySet<string>;
}): LLMModelEntry[] {
  if (fetched) return mapDoublewordModels(fetched, excludeIds);
  return Object.values(previousModels).filter(
    (model) => model.provider === DOUBLEWORD_PROVIDER && !excludeIds.has(model.id),
  );
}
