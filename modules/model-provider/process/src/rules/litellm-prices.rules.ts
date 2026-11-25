import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";
import { z } from "zod";

/**
 * Audio, transcription, realtime and image prices from litellm's registry. OpenRouter routes none
 * of these models. A model whose rates `LLMModelPricing` can't fully express is reported via
 * `unrepresentable` rather than dropped, so it never bills confidently on a partial price.
 */

/** The subset of a litellm price entry this mapper reads, parsed where the body enters. */
export const litellmPriceEntrySchema = z.object({
  mode: z.string().optional(),
  litellm_provider: z.string().optional(),
  input_cost_per_character: z.number().optional(),
  input_cost_per_second: z.number().optional(),
  input_cost_per_token: z.number().optional(),
  input_cost_per_audio_token: z.number().optional(),
  input_cost_per_image_token: z.number().optional(),
  output_cost_per_token: z.number().optional(),
  output_cost_per_audio_token: z.number().optional(),
  output_cost_per_image_token: z.number().optional(),
  output_cost_per_second: z.number().optional(),
  output_cost_per_character: z.number().optional(),
  input_cost_per_image: z.number().optional(),
  output_cost_per_image: z.number().optional(),
  input_cost_per_pixel: z.number().optional(),
  output_cost_per_pixel: z.number().optional(),
  cache_read_input_token_cost: z.number().optional(),
  /** The standard (five-minute) prompt-cache write rate. */
  cache_creation_input_token_cost: z.number().optional(),
});

export type LitellmPriceEntry = z.infer<typeof litellmPriceEntrySchema>;

/** A model upstream prices but the catalog cannot express yet. */
export type UnrepresentableModel = {
  id: string;
  fields: string[];
};

type LitellmMapping = {
  entries: LLMModelEntry[];
  unrepresentable: UnrepresentableModel[];
};

/** Providers whose audio models the LangWatch gateway can serve. */
const AUDIO_PROVIDERS = ["openai", "elevenlabs"];

/** Providers whose image models the LangWatch gateway can serve. */
const IMAGE_PROVIDERS = ["openai"];

/** The litellm mode that maps to catalog mode "image". */
const IMAGE_MODE = "image_generation";

/** litellm modes this mapper covers, with the providers it takes for each. */
const MODE_PROVIDERS: Record<string, readonly string[]> = {
  audio_speech: AUDIO_PROVIDERS,
  audio_transcription: AUDIO_PROVIDERS,
  realtime: AUDIO_PROVIDERS,
  [IMAGE_MODE]: IMAGE_PROVIDERS,
};

/** Flat image rates. The catalog prices tokens, characters and seconds only. */
const FLAT_IMAGE_FIELDS = [
  "input_cost_per_image",
  "output_cost_per_image",
  "input_cost_per_pixel",
  "output_cost_per_pixel",
] as const;

/** Dated snapshot ids (e.g. gpt-4o-mini-transcribe-2025-03-20) are noise. */
const DATED_VARIANT = /-\d{4}-\d{2}-\d{2}$/;

/**
 * Size and quality variants of an image model, such as `low/1024-x-1024/gpt-image-1`. They
 * bill a flat amount per image, which the catalog cannot express. The base id carries the
 * per-token rates the gateway meters against.
 */
const SIZED_VARIANT = /\d+-x-\d+\//;

const pickPositive = (value: number | undefined): number | undefined =>
  typeof value === "number" && value > 0 ? value : undefined;

/**
 * litellm rates that would change the bill and have no `LLMModelPricing`
 * field. An output rate equal to its input counterpart needs no separate
 * field; only a genuinely different rate is unrepresentable.
 */
function unrepresentableFields(price: LitellmPriceEntry, mode: string): string[] {
  const fields: string[] = [];
  const differs = (a: number | undefined, b: number | undefined): boolean =>
    pickPositive(a) !== undefined && pickPositive(a) !== pickPositive(b);

  if (differs(price.output_cost_per_second, price.input_cost_per_second)) {
    fields.push("output_cost_per_second");
  }
  if (differs(price.output_cost_per_character, price.input_cost_per_character)) {
    fields.push("output_cost_per_character");
  }

  // On an image generation model a flat per-image or per-pixel rate is the
  // whole bill, so the model is held back. On a model priced per token, such
  // as a realtime model that also takes an image, the token rates carry the
  // bill and the model keeps them.
  if (mode === IMAGE_MODE) {
    for (const field of FLAT_IMAGE_FIELDS) {
      if (pickPositive(price[field]) !== undefined) fields.push(field);
    }
  }
  return fields;
}

/** Maps the litellm rate set onto catalog pricing fields. */
function toPricing(price: LitellmPriceEntry): LLMModelPricing | null {
  const pricing: LLMModelPricing = {
    inputCostPerToken: pickPositive(price.input_cost_per_token) ?? 0,
    outputCostPerToken: pickPositive(price.output_cost_per_token) ?? 0,
  };

  const perCharacter = pickPositive(price.input_cost_per_character);
  if (perCharacter !== undefined) pricing.inputCostPerCharacter = perCharacter;

  const perSecond = pickPositive(price.input_cost_per_second);
  if (perSecond !== undefined) pricing.inputCostPerSecond = perSecond;

  const perAudioToken = pickPositive(price.input_cost_per_audio_token);
  if (perAudioToken !== undefined) pricing.audioCostPerToken = perAudioToken;

  const perAudioOutputToken = pickPositive(price.output_cost_per_audio_token);
  if (perAudioOutputToken !== undefined) pricing.audioOutputCostPerToken = perAudioOutputToken;

  const perImageToken = pickPositive(price.input_cost_per_image_token);
  if (perImageToken !== undefined) pricing.imageCostPerToken = perImageToken;

  const perImageOutputToken = pickPositive(price.output_cost_per_image_token);
  if (perImageOutputToken !== undefined) pricing.imageOutputCostPerToken = perImageOutputToken;

  const cacheRead = pickPositive(price.cache_read_input_token_cost);
  if (cacheRead !== undefined) pricing.inputCacheReadPerToken = cacheRead;

  // litellm publishes 0 for vendors that do not charge for cache writes, which
  // `pickPositive` drops, so those entries carry no write rate rather than a zero one.
  const cacheWrite = pickPositive(price.cache_creation_input_token_cost);
  if (cacheWrite !== undefined) pricing.inputCacheWritePerToken = cacheWrite;

  const priced =
    pricing.inputCostPerToken > 0 ||
    pricing.outputCostPerToken > 0 ||
    pricing.inputCostPerCharacter !== undefined ||
    pricing.inputCostPerSecond !== undefined ||
    pricing.imageCostPerToken !== undefined ||
    pricing.imageOutputCostPerToken !== undefined;

  return priced ? pricing : null;
}

function describeAudio(mode: string, pricing: LLMModelPricing): string {
  const durationUnit =
    pricing.inputCostPerSecond !== undefined ? "per second of audio" : "per token";
  const unit = pricing.inputCostPerCharacter !== undefined ? "per input character" : durationUnit;
  const listeningKind = mode === "realtime" ? "Realtime audio" : "Speech-to-text";
  const kind = mode === "audio_speech" ? "Speech synthesis" : listeningKind;
  return `${kind}, priced ${unit}. Synced from litellm's price registry.`;
}

/**
 * Maps litellm price entries to catalog entries: `audio_speech`, `audio_transcription`,
 * `realtime` and `image_generation` from supported providers with at least one expressible
 * rate and none inexpressible. `excludeIds` skips the overlay's own ids.
 */
export function mapLitellmModels(
  prices: Record<string, LitellmPriceEntry>,
  excludeIds: ReadonlySet<string>,
): LitellmMapping {
  const entries: LLMModelEntry[] = [];
  const unrepresentable: UnrepresentableModel[] = [];

  for (const [rawId, price] of Object.entries(prices)) {
    if (!isCurrentPrice(rawId, price)) continue;
    const mode = price.mode ?? "";
    const provider = price.litellm_provider ?? "";

    const id = rawId.includes("/") ? rawId : `${provider}/${rawId}`;
    if (excludeIds.has(id)) continue;

    const missing = unrepresentableFields(price, mode);
    if (missing.length > 0) {
      unrepresentable.push({ id, fields: missing });
      continue;
    }

    const pricing = toPricing(price);
    if (!pricing) continue;

    entries.push(
      mode === IMAGE_MODE
        ? imageEntry({ id, provider, pricing })
        : audioEntry({ id, provider, mode, pricing }),
    );
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  unrepresentable.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, unrepresentable };
}

const modelNameOf = (id: string): string => id.split("/").slice(1).join("/");

function audioEntry({
  id,
  provider,
  mode,
  pricing,
}: {
  id: string;
  provider: string;
  mode: string;
  pricing: LLMModelPricing;
}): LLMModelEntry {
  const isSpeech = mode === "audio_speech";
  const isRealtime = mode === "realtime";

  return {
    id,
    name: modelNameOf(id),
    provider,
    pricing,
    contextLength: 0,
    maxCompletionTokens: null,
    supportedParameters: [],
    defaultParameters: null,
    modality: audioModalityOf({ isRealtime, isSpeech }),
    mode: "audio",
    description: describeAudio(mode, pricing),
    supportsImageInput: false,
    supportsAudioInput: !isSpeech,
    supportsImageOutput: false,
    supportsAudioOutput: isSpeech || isRealtime,
  };
}

/**
 * An image generation entry. Image input is on because these models take an
 * image to edit as well as a prompt, and the image input rate prices it.
 */
function imageEntry({
  id,
  provider,
  pricing,
}: {
  id: string;
  provider: string;
  pricing: LLMModelPricing;
}): LLMModelEntry {
  return {
    id,
    name: modelNameOf(id),
    provider,
    pricing,
    contextLength: 0,
    maxCompletionTokens: null,
    supportedParameters: [],
    defaultParameters: null,
    modality: "text->image",
    mode: "image",
    description:
      "Image generation and editing, priced per token in three buckets: " +
      "text input, image input and image output. Synced from litellm's price registry.",
    supportsImageInput: true,
    supportsAudioInput: false,
    supportsImageOutput: true,
    supportsAudioOutput: false,
  };
}

/**
 * Catalog-shaped pricing for every model litellm publishes, keyed by
 * catalog id. Wider than `mapLitellmModels` on purpose, since the
 * drift audit compares whatever it CAN express against the overlay's rates.
 */
export function litellmPricingById(
  prices: Record<string, LitellmPriceEntry>,
): Record<string, LLMModelPricing> {
  const byId: Record<string, LLMModelPricing> = {};
  for (const [rawId, price] of Object.entries(prices)) {
    if (DATED_VARIANT.test(rawId)) continue;
    const pricing = toPricing(price);
    if (!pricing) continue;
    const provider = price.litellm_provider ?? "";
    byId[rawId.includes("/") ? rawId : `${provider}/${rawId}`] = pricing;
  }
  return byId;
}

function audioModalityOf({ isRealtime, isSpeech }: { isRealtime: boolean; isSpeech: boolean }) {
  if (isRealtime) return "audio->audio";
  return isSpeech ? "text->audio" : "audio->text";
}

function isCurrentPrice(rawId: string, price: LitellmPriceEntry): boolean {
  const providers = MODE_PROVIDERS[price.mode ?? ""];
  if (!providers) return false;
  if (!providers.includes(price.litellm_provider ?? "")) return false;
  return !DATED_VARIANT.test(rawId) && !SIZED_VARIANT.test(rawId);
}
