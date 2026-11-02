import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { z } from "zod";

/**
 * Doubleword models and prices. The catalog id is `doubleword/<alias>` with the case kept, because
 * the inference API takes the alias as the model, exactly. The price is the active realtime
 * tariff: a batch-only model is left out. Cache prices are multipliers of the input rate.
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
  alias: z.string().nullish(),
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

/** Whether a tariff's window is still open at `now`; an unreadable end date counts as closed. */
function isOpenAt({ tariff, now }: { tariff: DoublewordTariff; now: Instant }): boolean {
  if (!tariff.valid_until) return true;
  try {
    return Temporal.Instant.compare(Temporal.Instant.from(tariff.valid_until), now) > 0;
  } catch {
    return false;
  }
}

/** The active realtime tariff open at `now`, or undefined when the model is batch-only. */
function pickRealtimeTariff({
  model,
  now,
}: {
  model: DoublewordModel;
  now: Instant;
}): DoublewordTariff | undefined {
  return model.tariffs?.find(
    (tariff) =>
      tariff.api_key_purpose === "realtime" && tariff.is_active && isOpenAt({ tariff, now }),
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

/** The id the gateway calls the model by: the alias, or the name when the alias is missing. */
function catalogIdOf(model: DoublewordModel): string {
  return `${DOUBLEWORD_PROVIDER}/${model.alias || model.model_name}`;
}

/** Whether the tariff carries a usable rate: an input rate, and an output rate unless it embeds. */
function isPriced({
  tariff,
  isEmbedding,
}: {
  tariff: DoublewordTariff;
  isEmbedding: boolean;
}): boolean {
  if (parsePrice(tariff.input_price_per_token) <= 0) return false;
  return isEmbedding || parsePrice(tariff.output_price_per_token) > 0;
}

/**
 * Maps one Doubleword model to a catalog entry, or undefined when the model
 * has no realtime price or is a type the catalog does not cover.
 */
export function mapDoublewordModel({
  model,
  now,
}: {
  model: DoublewordModel;
  now: Instant;
}): LLMModelEntry | undefined {
  const tariff = pickRealtimeTariff({ model, now });
  if (!tariff) return undefined;

  const type = model.model_type.toUpperCase();
  if (type !== "CHAT" && type !== "EMBEDDINGS") return undefined;
  const isEmbedding = type === "EMBEDDINGS";
  if (!isPriced({ tariff, isEmbedding })) return undefined;
  const capabilities = model.capabilities ?? [];
  const supportsImageInput = !isEmbedding && capabilities.includes("vision");
  const chatParameters = capabilities.includes("reasoning")
    ? [...CHAT_PARAMETERS, "reasoning"]
    : CHAT_PARAMETERS;

  return {
    id: catalogIdOf(model),
    name: `Doubleword: ${model.display_name || model.model_name}`,
    provider: DOUBLEWORD_PROVIDER,
    pricing: mapPricing(tariff, model.cache_pricing),
    contextLength: model.metadata?.context_window ?? 0,
    maxCompletionTokens: null,
    supportedParameters: isEmbedding ? [] : chatParameters,
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
export function mapDoublewordModels({
  models,
  excludeIds = new Set(),
  now,
}: {
  models: readonly DoublewordModel[];
  excludeIds?: ReadonlySet<string>;
  now: Instant;
}): LLMModelEntry[] {
  const entries: LLMModelEntry[] = [];
  for (const model of models) {
    const entry = mapDoublewordModel({ model, now });
    if (entry && !excludeIds.has(entry.id)) entries.push(entry);
  }
  return entries;
}

/**
 * The Doubleword entries a sync run writes. With no list, a list with no priced model (an
 * inference key lists no prices), or a listed model whose realtime tariff has no price, the
 * entries already on disk are kept, so a bad run does not delete them. `excludeIds` always wins.
 */
export function resolveDoublewordEntries({
  fetched,
  previousModels,
  excludeIds,
  now,
}: {
  fetched: readonly DoublewordModel[] | undefined;
  previousModels: Record<string, LLMModelEntry>;
  excludeIds: ReadonlySet<string>;
  now: Instant;
}): LLMModelEntry[] {
  const mapped = fetched ? mapDoublewordModels({ models: fetched, excludeIds, now }) : [];
  if (mapped.length > 0) {
    const mappedIds = new Set(mapped.map((entry) => entry.id));
    const unpricedKept = (fetched ?? [])
      .filter((model) => pickRealtimeTariff({ model, now }))
      .map((model) => previousModels[catalogIdOf(model)])
      .filter(
        (entry): entry is LLMModelEntry =>
          entry !== undefined && !mappedIds.has(entry.id) && !excludeIds.has(entry.id),
      );
    return [...mapped, ...unpricedKept];
  }
  return Object.values(previousModels).filter(
    (model) => model.provider === DOUBLEWORD_PROVIDER && !excludeIds.has(model.id),
  );
}
